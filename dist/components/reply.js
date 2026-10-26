"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V2_FLAG = void 0;
exports.replyV2 = replyV2;
exports.editReplyV2 = editReplyV2;
exports.followUpV2 = followUpV2;
exports.updateV2 = updateV2;
exports.sendV2WithLargeFile = sendV2WithLargeFile;
exports.sendV2 = sendV2;
exports.successContainer = successContainer;
exports.errorContainer = errorContainer;
exports.warningContainer = warningContainer;
exports.infoContainer = infoContainer;
exports.replySuccess = replySuccess;
exports.replyError = replyError;
exports.replyWarning = replyWarning;
exports.replyInfo = replyInfo;
exports.deferIfNeeded = deferIfNeeded;
exports.deferUpdateIfNeeded = deferUpdateIfNeeded;
const discord_js_1 = require("discord.js");
const branding_1 = require("../constants/branding");
const discord_1 = require("../utils/discord");
const v2_1 = require("./v2");
/**
 * Envio de mensagens Components V2.
 *
 * Toda resposta do bot passa por aqui para garantir:
 *  - flag `IsComponentsV2` sempre presente;
 *  - `allowedMentions` sempre explicito (padrao: nao mencionar ninguem);
 *  - tratamento correto de interacao ja respondida/deferida.
 */
exports.V2_FLAG = discord_js_1.MessageFlags.IsComponentsV2;
/**
 * Uma mensagem V2 aceita ate 10 componentes de topo, entao um painel pode ser
 * dividido em varios containers quando um so estouraria o limite de 10 filhos.
 */
function toComponents(root) {
    // `instanceof` em vez de `Array.isArray`: sobre `readonly T[]` o guard do
    // Array estreita para `any[]` e derruba a tipagem do payload inteiro.
    return root instanceof discord_js_1.ContainerBuilder ? [root] : [...root];
}
function replyPayload(root, options = {}) {
    const flags = options.ephemeral === true ? exports.V2_FLAG | discord_js_1.MessageFlags.Ephemeral : exports.V2_FLAG;
    return {
        components: toComponents(root),
        flags,
        allowedMentions: options.allowedMentions ?? discord_1.NO_MENTIONS,
        ...(options.files !== undefined ? { files: [...options.files] } : {}),
    };
}
function editPayload(root, options = {}) {
    return {
        components: toComponents(root),
        flags: exports.V2_FLAG,
        allowedMentions: options.allowedMentions ?? discord_1.NO_MENTIONS,
        /*
         * `attachments: []` junto com `files` significa SUBSTITUIR os anexos, nao
         * acrescentar. Sem isso, um painel que e reeditado varias vezes (o pedido
         * do cliente, que tem botao "Atualizar") acumularia um QR novo a cada
         * clique — e o Discord passaria a mostrar a imagem antiga junto da nova.
         */
        ...(options.files !== undefined
            ? { files: [...options.files], attachments: [] }
            : {}),
    };
}
/** Responde a interacao com um container V2. */
async function replyV2(interaction, root, options = {}) {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(editPayload(root, options));
        return;
    }
    await interaction.reply(replyPayload(root, options));
}
/** Edita a resposta original (apos deferReply). */
async function editReplyV2(interaction, root, options = {}) {
    await interaction.editReply(editPayload(root, options));
}
/** Envia uma mensagem adicional na mesma interacao. */
async function followUpV2(interaction, root, options = {}) {
    await interaction.followUp(replyPayload(root, options));
}
/** Atualiza a mensagem que originou a interacao de componente. */
async function updateV2(interaction, root, options = {}) {
    const payload = {
        components: toComponents(root),
        flags: exports.V2_FLAG,
        allowedMentions: options.allowedMentions ?? discord_1.NO_MENTIONS,
        ...(options.files !== undefined ? { files: [...options.files] } : {}),
    };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(editPayload(root, options));
        return;
    }
    await interaction.update(payload);
}
/**
 * Cliente REST exclusivo para anexos grandes.
 *
 * O REST do discord.js desiste de qualquer chamada em 15 s e, ao desistir,
 * TENTA DE NOVO sozinho (ate 3 vezes). Para mensagem comum isso e o certo. Para
 * um anexo de 100 MB sao dois defeitos: 15 s nao bastam para subir o arquivo, e
 * uma tentativa abortada DEPOIS de o Discord ja ter recebido o corpo inteiro
 * criaria a mensagem duas vezes — um post duplicado no canal publico.
 *
 * Aqui: prazo longo e ZERO repeticao automatica. Falhou, quem chamou fica
 * sabendo e decide; nunca duplica. Um cliente so, reaproveitado: cada `REST`
 * novo abriria seu proprio pool de conexoes.
 */
const LARGE_UPLOAD_TIMEOUT_MS = 5 * 60_000;
let largeUploadRest = null;
function largeUploadClient(client) {
    if (largeUploadRest === null) {
        largeUploadRest = new discord_js_1.REST({ timeout: LARGE_UPLOAD_TIMEOUT_MS, retries: 0 });
    }
    return largeUploadRest.setToken(client.token);
}
/** `allowedMentions` do discord.js no formato cru que o REST espera. */
function rawAllowedMentions(options) {
    const mentions = options.allowedMentions;
    if (mentions === undefined)
        return { parse: [] };
    return {
        parse: mentions.parse ?? [],
        ...(mentions.users !== undefined ? { users: mentions.users } : {}),
        ...(mentions.roles !== undefined ? { roles: mentions.roles } : {}),
    };
}
/**
 * Envia um container V2 com UM anexo grande.
 *
 * Mesmo contrato do `sendV2` — flag V2, ninguem mencionado por padrao — mas
 * pelo cliente de prazo longo. O anexo e referenciado no container por
 * `attachment://nome`.
 *
 * Serve canal, topico e DM: o unico que importa e o id, porque a chamada e
 * `Routes.channelMessages`.
 */
async function sendV2WithLargeFile(channel, root, file, options = {}) {
    const message = (await largeUploadClient(channel.client).post(discord_js_1.Routes.channelMessages(channel.id), {
        body: {
            components: [root.toJSON()],
            flags: exports.V2_FLAG,
            allowed_mentions: rawAllowedMentions(options),
            attachments: [{ id: 0, filename: file.name }],
        },
        files: [
            {
                name: file.name,
                data: file.data,
                ...(file.contentType !== undefined ? { contentType: file.contentType } : {}),
            },
        ],
    }));
    return { id: message.id, channelId: message.channel_id };
}
/** Envia um container V2 para um canal. */
async function sendV2(channel, root, options = {}) {
    const payload = {
        components: toComponents(root),
        flags: exports.V2_FLAG,
        allowedMentions: options.allowedMentions ?? discord_1.NO_MENTIONS,
        ...(options.files !== undefined ? { files: [...options.files] } : {}),
    };
    return channel.send(payload);
}
function noticeContainer(accent, icon, message, options = {}) {
    const root = (0, v2_1.container)(accent);
    if (options.title !== undefined) {
        root.addTextDisplayComponents((0, v2_1.heading)(options.title));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`${icon} ${message}`));
    if (options.footer !== undefined) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.footerNote)(options.footer));
    }
    return root;
}
function successContainer(message, options = {}) {
    return noticeContainer(branding_1.COLORS.SUCCESS, '✅', message, options);
}
function errorContainer(message, options = {}) {
    return noticeContainer(branding_1.COLORS.DANGER, '⛔', message, options);
}
function warningContainer(message, options = {}) {
    return noticeContainer(branding_1.COLORS.WARNING, '⚠️', message, options);
}
function infoContainer(message, options = {}) {
    return noticeContainer(branding_1.COLORS.INFO, 'ℹ️', message, options);
}
/** Resposta efemera de sucesso. */
async function replySuccess(interaction, message, options = {}) {
    await replyV2(interaction, successContainer(message, options), {
        ...options,
        ephemeral: options.ephemeral ?? true,
    });
}
/** Resposta efemera de erro (mensagem ja precisa ser segura para o usuario). */
async function replyError(interaction, message, options = {}) {
    await replyV2(interaction, errorContainer(message, options), {
        ...options,
        ephemeral: options.ephemeral ?? true,
    });
}
async function replyWarning(interaction, message, options = {}) {
    await replyV2(interaction, warningContainer(message, options), {
        ...options,
        ephemeral: options.ephemeral ?? true,
    });
}
async function replyInfo(interaction, message, options = {}) {
    await replyV2(interaction, infoContainer(message, options), {
        ...options,
        ephemeral: options.ephemeral ?? true,
    });
}
/**
 * Defer seguro: nao lanca se a interacao ja foi respondida.
 * `InteractionDeferReplyOptions` aceita apenas a flag Ephemeral — a flag V2
 * entra depois, no `editReply`.
 */
async function deferIfNeeded(interaction, options = {}) {
    if (interaction.deferred || interaction.replied)
        return;
    await interaction.deferReply(options.ephemeral === true ? { flags: discord_js_1.MessageFlags.Ephemeral } : {});
}
/** Defer de update (mantem a mensagem atual enquanto processa). */
async function deferUpdateIfNeeded(interaction) {
    if (interaction.deferred || interaction.replied)
        return;
    await interaction.deferUpdate();
}
//# sourceMappingURL=reply.js.map