import { api, opendiscord, utilities } from "#opendiscord";
import * as discord from "discord.js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { getMessage } from "./languages";

//DECLARATION
declare module "#opendiscord-types" {
    export interface ODPluginManagerIds_Default {
        "ia-helper": api.ODPlugin;
    }
    export interface ODConfigManagerIds_Default {
        "ia-helper:config": IAConfig;
        "ia-helper:prompts": IAPromptsConfig;
    }
}
class IAConfig extends api.ODJsonConfig {
    declare data: {
        enabled: boolean;
        apiKey: string;
        assistantKey: string;
        confidenceThreshold: number;
        language?: string;
        staffRoleId?: string;
        devRoleId?: string;
        maxIAMessages?: string;
    };
}
class IAPromptsConfig extends api.ODJsonConfig {
    declare data: object;
}

//REGISTER CONFIGS (register our config files)
opendiscord.events.get("onConfigLoad").listen((configs) => {
    configs.add(new IAConfig("ia-helper:config", "config.json", "./plugins/ia-helper/"));
    configs.add(new IAPromptsConfig("ia-helper:prompts", "prompts.json", "./plugins/ia-helper/"));
});

//LISTEN FOR TICKET CREATION (after initial message has been sent)
//This function activates after the "ticket message" (with the buttons) has been sent in the ticket.
opendiscord.events.get("afterTicketMainMessageCreated").listen(async (ticket, msg, channel, user) => {
    const config = opendiscord.configs.get("ia-helper:config");
    const panels = JSON.parse(fs.readFileSync("./config/panels.json", "utf-8"));

    const panel = panels.find(p => p.options.includes(ticket.option.id.value));
    if (!panel || !panel.enableIA) {
        console.log(`[IA-Helper] Assistance IA désactivée pour ce panel.`);
        return;
    }

    const prompts = opendiscord.configs.get("ia-helper:prompts");
    const lang = config.data.language || "fr";
    const apiKey = config.data.apiKey;
    const openai = new OpenAI({ apiKey });

    const optionId = ticket.option.id.value || "default";
    const systemPrompt = prompts.data[optionId] || prompts.data["default"];

    await channel.send(getMessage(lang, "welcome"));

    let iaRetired = false;
    let iaMessageCount = 0; // Compteur de messages générés par l'IA
    const maxIAMessages = config.data.maxIAMessages || 10; // Limite configurable
    const thread = await openai.beta.threads.create();

    const collector = channel.createMessageCollector(); // No time limit

    collector.on("collect", async (msg) => {
        if (msg.author.bot || iaRetired) return;

        const isStaff = msg.member?.roles?.cache?.has(config.data.staffRoleId || "");
        if (isStaff && msg.author.id !== user.id) {
            iaRetired = true;
            return;
        }

        if (msg.author.id === user.id) {
            await channel.sendTyping();

            try {
                const fullPrompt = `Always respond in the same language as the user uses.\n\n${systemPrompt}`;

                await openai.beta.threads.messages.create(thread.id, {
                    role: "assistant",
                    content: fullPrompt
                });
                await openai.beta.threads.messages.create(thread.id, {
                    role: "user",
                    content: msg.content
                });

                const run = await openai.beta.threads.runs.create(thread.id, {
                    assistant_id: config.data.assistantKey
                });

                let runStatus = run;
                while (runStatus.status !== "completed" && runStatus.status !== "failed") {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    runStatus = await openai.beta.threads.runs.retrieve(thread.id, runStatus.id);
                }

                if (runStatus.status === "completed") {
                    const messages = await openai.beta.threads.messages.list(thread.id);
                    const lastMsg = messages.data.find(m => m.role === "assistant");

                    const textBlock = lastMsg?.content.find(block => block.type === "text");

                    let iaReply = textBlock && "text" in textBlock && "value" in textBlock.text
                        ? textBlock.text.value
                        : "Je n'ai pas pu générer de réponse.";

                    iaReply = iaReply.replace(/【[^【】]*】/g, "").trim();

                    iaMessageCount++; // Incrémenter le compteur de messages IA

                    if (iaMessageCount >= Number(maxIAMessages)) {
                        iaRetired = true;
                        await channel.send(getMessage(lang, "transferred", {
                            staffRole: `<@&${config.data.staffRoleId}>`
                        }));
                        return;
                    }

                    const staffMention = `<@&${config.data.staffRoleId}>`;

                    if (iaReply.toLowerCase().includes(staffMention.toLowerCase())) {
                        iaRetired = true;
                        await channel.send(getMessage(lang, "transferred", {
                            staffRole: `<@&${config.data.staffRoleId}>`
                        }));
                    } else {
                        await channel.send(iaReply);
                    }

                } else {
                    iaRetired = true;
                    await channel.send(getMessage(lang, "failure", {
                        adminRole: `<@&${config.data.devRoleId}>`
                    }));
                }

            } catch (err) {
                iaRetired = true;
                console.error("[IA-Helper] Error OpenAI:", err);
                await channel.send(getMessage(lang, "error", {
                    adminRole: `<@&${config.data.devRoleId}>`
                }));
            }
        }
    });
});