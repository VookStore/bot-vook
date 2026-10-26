"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyAlert = notifyAlert;
exports.resetAlertWindows = resetAlertWindows;
const discord_js_1 = require("discord.js");
const env_1 = require("../../config/env");
const limits_1 = require("../../constants/limits");
const v2_1 = require("../../components/v2");
const branding_1 = require("../../constants/branding");
const redact_1 = require("../logger/redact");
const clientHolder_1 = require("../client/clientHolder");
const Logger_1 = require("../logger/Logger");
/**
 * Alerta de erro num canal do Discord.
 *
 * POR QUE EXISTE. Todo erro de fundo do bot ia para o arquivo de log e para a
 * tabela `system_error_logs` — dois lugares que ninguem abre por vontade
 * propria. Na pratica, cada falha era descoberta por acaso ou por reclamacao de
 * cliente, as vezes dias depois. Este modulo faz o erro chegar a alguem no
 * momento em que acontece.
 *
 * O SILENCIO E DELIBERADO EM DOIS PONTOS:
 *
 *  1. NADA AQUI LANCA. Um alerta que falha nao pode virar um erro que dispara
 *     outro alerta — seria um laco alimentado pela propria falha. Toda excecao
 *     morre aqui dentro, no maximo virando uma linha de log.
 *  2. REPETICAO E AGRUPADA. Um job que quebra a cada rodada produziria uma
 *     mensagem por minuto ate alguem silenciar o canal — e canal silenciado nao
 *     alerta ninguem. A primeira ocorrencia sai na hora; as seguintes sao
 *     contadas e viram um resumo quando a janela fecha.
 *
 * SEGREDO NAO PASSA. Mensagem, stack e contexto vao pelo mesmo redator usado
 * na tabela de erros. O canal e privado, mas "privado" e uma configuracao que
 * alguem pode afrouxar sem pensar no que ja foi escrito ali.
 */
const logger = (0, Logger_1.createLogger)('alert');
const windows = new Map();
/**
 * Assinatura do erro para agrupar repeticoes.
 *
 * Modulo + tipo + a PRIMEIRA LINHA da mensagem. A primeira linha basta e evita
 * que um detalhe variavel no fim (um id, um tempo de retry) transforme o mesmo
 * defeito em assinaturas diferentes — que era justamente o caso do rate limit
 * do gateway, cuja mensagem carrega os segundos que faltam.
 */
function signatureOf(moduleName, error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    return `${moduleName}:${name}:${message.split('\n')[0]?.slice(0, 120) ?? ''}`;
}
/** Canal configurado, ou `null` quando o alerta esta desligado ou inacessivel. */
async function resolveChannel() {
    const channelId = (0, env_1.getEnv)().ALERT_CHANNEL_ID;
    if (channelId === null)
        return null;
    const client = (0, clientHolder_1.tryGetClient)();
    if (client === null)
        return null;
    try {
        const channel = await client.channels.fetch(channelId);
        return channel !== null && channel.type === discord_js_1.ChannelType.GuildText ? channel : null;
    }
    catch {
        return null;
    }
}
/** Uma linha `chave: valor` por entrada util do contexto. */
function renderContext(context) {
    const safe = (0, redact_1.redactContext)(context);
    const linhas = Object.entries(safe)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .slice(0, limits_1.ALERT.MAX_CONTEXT_FIELDS)
        .map(([key, value]) => `\`${key}\`: ${String(value).slice(0, 120)}`);
    return linhas.join('\n');
}
function buildAlert(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.DANGER);
    const message = (0, redact_1.redactString)(params.error instanceof Error ? params.error.message : String(params.error));
    root.addTextDisplayComponents((0, v2_1.text)(`### 🔴 Falha em \`${params.moduleName}\``), (0, v2_1.text)(`\`\`\`\n${message.slice(0, limits_1.ALERT.MAX_MESSAGE_CHARS)}\n\`\`\``));
    const contexto = renderContext(params.context);
    if (contexto.length > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(contexto));
    }
    /*
     * O numero de repeticoes e a informacao mais util do alerta agrupado: "isto
     * aconteceu 47 vezes" e um problema de outra natureza que "isto aconteceu".
     */
    if (params.suppressed > 0) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Repetiu mais ${params.suppressed} vez(es) nos ultimos minutos.`));
    }
    return root;
}
/**
 * Publica o alerta, agrupando repeticoes.
 *
 * Nunca lanca e nunca chama o tratador de erros — quem o chama ja esta tratando
 * uma falha, e um segundo erro daqui apagaria o primeiro.
 */
async function notifyAlert(moduleName, error, context = {}) {
    try {
        const signature = signatureOf(moduleName, error);
        const now = Date.now();
        const pending = windows.get(signature);
        // Janela aberta: conta e cala.
        if (pending !== undefined && now < pending.until) {
            pending.suppressed += 1;
            return;
        }
        const channel = await resolveChannel();
        if (channel === null) {
            windows.set(signature, { suppressed: 0, until: now + limits_1.ALERT.WINDOW_MS });
            return;
        }
        const suppressed = pending?.suppressed ?? 0;
        windows.set(signature, { suppressed: 0, until: now + limits_1.ALERT.WINDOW_MS });
        await channel.send({
            components: [buildAlert({ moduleName, error, context, suppressed })],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    }
    catch (alertError) {
        /*
         * Fim da linha. Este catch NAO pode chamar `handleBackgroundError`: ele
         * chamaria `notifyAlert` de volta e o laco se alimentaria da propria falha.
         */
        logger.warn('Nao foi possivel publicar o alerta.', {
            module: moduleName,
            detail: alertError instanceof Error ? alertError.message : String(alertError),
        });
    }
}
/** Somente para testes: esquece as janelas de agrupamento. */
function resetAlertWindows() {
    windows.clear();
}
//# sourceMappingURL=AlertService.js.map