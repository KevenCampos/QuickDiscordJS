import Discord, { Client, ClientOptions, GatewayIntentBits, Collection, Events, Interaction, MessagePayload, InteractionReplyOptions, InteractionResponse, BooleanCache, Message, CommandInteraction } from "discord.js";
import { interactionHandlers } from "./InteractionHandler";
import { slashCommandHandlers } from "./SlashCommand";

import { pathToFileURL } from 'url';
import { utils } from "../functions/index"
import { z } from "zod";

import * as path from 'path';
import { ISlashCommandHandler } from "./SlashCommand";

const allIntents: GatewayIntentBits[] = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping
];

interface CustomOptions {
    autoImport?: string[];
    intents?: GatewayIntentBits[];
}

export default class EaseClient extends Client {

    customOptions?: CustomOptions;
    slashCommands: Collection<string, ISlashCommandHandler> = new Collection();
    slashArray: any[] = [];

    constructor({ autoImport, intents }: { autoImport?: string[], intents?: GatewayIntentBits[] } = {}) {
        
        const intentsValidation = z.array(z.nativeEnum(GatewayIntentBits), { invalid_type_error: "Intents list must be a GatewayIntentBits object from discord" });
        intentsValidation.parse(intents || allIntents);

        const customOptions = { autoImport, intents };
        const options: ClientOptions = {
            intents: customOptions.intents || allIntents
        };

        super(options);
        this.customOptions = customOptions;
    }

    public async login(token: string): Promise<string> {

        const tokenValidation = z.string({ required_error: "Token is required", invalid_type_error: "Token must be a string" });
        tokenValidation.parse(token);

        const result = super.login(token);
        this.startListening();

        return result;
    }

    public async invokeInteraction(interactionName: string, interaction: Interaction | CommandInteraction){
        const runInteractionHandler = this.getInteractionCallback(interactionName, interaction) ;
        if (runInteractionHandler) return await runInteractionHandler();
    }

    public reloadCommands() {
        this.guilds.cache.forEach(guild => guild.commands.set(this.slashArray))
    }
    
    private async loadAutoImportPaths() {
        const root_path = path.resolve();
    
        this.slashCommands = new Discord.Collection();
        const autoImportPath = this.customOptions?.autoImport;
    
        if (autoImportPath) {
            for (const importPath of autoImportPath) {
                const files = utils.getRecursiveFiles(`${root_path}/${importPath}`);
                if (!files) throw new Error(`Auto Import path not found: '${importPath}'. You need to pass a valid path to the components folder`);
    
                for (const file of files) {
                    const isValidFile = file.endsWith('.mjs') || file.endsWith('.js') || file.endsWith(".ts");
                    if (!isValidFile) continue;
    
                    const componentPath = pathToFileURL(file).href;
                    await import(componentPath).catch(err => {
                        throw new Error(`Error on import component: ${err}`)
                    });
                }
            }
        }
    
        for (const [key, value] of slashCommandHandlers.entries()) {
            this.slashCommands.set(key, value);
            this.slashArray.push(value);
        }
    }
    
    private startListening() {

        this.once(Events.ClientReady, async (client) => {
            await this.loadAutoImportPaths();
            this.reloadCommands();
        });

        this.on(Events.InteractionCreate, async (interaction: Interaction) => {
            if (interaction.isCommand()) {
                const command = this.slashCommands.get(interaction.commandName)
                
                if (!command){
                    return interaction.reply({content: 'Error on interaction! Command not found.', ephemeral: true});
                }

                command.run(this, interaction);
            }

            if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()){
                const runInteractionHandler = this.getInteractionCallback(interaction.customId, interaction) ;
                if (runInteractionHandler) return await runInteractionHandler();
            }
        });

        this.on(Events.GuildCreate, async () => {
            this.reloadCommands();
        })
    }

    private getInteractionCallback(customId: string, interaction: Interaction | CommandInteraction){
        if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isCommand() || interaction.isModalSubmit()){
            let customId_without_params = customId?.split(":")[0];
            const interactionHandler = interactionHandlers.get(customId) || interactionHandlers.get(customId_without_params);
    
            if (interactionHandler) {
                let params: any[] = [];
    
                if (interactionHandler.useParams) {
                    const separate_params = customId.split(":"); // separando os parametros, por exemplo: ['guild_id', 'client_id']
                    params = separate_params.slice(1); // pegando os parametros, por exemplo: ['guild_id', 'client_id']
                }
    
                const callback = interactionHandlers.get(interactionHandler.useParams ? customId_without_params : customId)?.run;
                if (!callback) return console.log(`\x1b[36mCallback not found for customId: ${customId}\x1b[0m`);
    
                // vamos retornar a função para ser chamada posteriormente
                return interactionHandler.useParams ? callback.bind(null, this, interaction, ...params) : callback.bind(null, this, interaction)
            }
        }
    }
}