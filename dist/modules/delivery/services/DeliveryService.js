"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDeliveryChannel = resolveDeliveryChannel;
exports.assertCanConfirmReceipt = assertCanConfirmReceipt;
exports.confirmReceipt = confirmReceipt;
exports.deliverProduct = deliverProduct;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const TransferQueue_1 = require("../../../core/queue/TransferQueue");
const discord_1 = require("../../../utils/discord");
const download_1 = require("../../../utils/download");
const sanitize_1 = require("../../../utils/sanitize");
const limits_1 = require("../../../constants/limits");
const AssetHostingService_1 = require("../../hosting/AssetHostingService");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const OrderNotificationService_1 = require("../../catalog/services/OrderNotificationService");
const DemandBoardService_1 = require("../../demands/services/DemandBoardService");
const OrderService_1 = require("../../catalog/services/OrderService");
const TicketInternalPanelBuilder_1 = require("../../tickets/builders/TicketInternalPanelBuilder");
const TicketRepository_1 = require("../../tickets/repositories/TicketRepository");
const TicketCloseService_1 = require("../../tickets/services/TicketCloseService");
const TicketDoneService_1 = require("../../tickets/services/TicketDoneService");
const TicketLocatorService_1 = require("../../tickets/services/TicketLocatorService");
const DeliveryBuilders_1 = require("../builders/DeliveryBuilders");
const product_1 = require("../validators/product");
/**
 * Entrega do produto dentro do ticket.
 *
 * A ORDEM DAS TRES COISAS NAO E ARBITRARIA: primeiro o arquivo chega ao
 * cliente, depois a copia na DM, por ultimo o pedido muda de estado. E a ordem
 * que sobrevive a uma falha no meio — um pedido marcado ENTREGUE sem entrega
 * seria mentira no historico, enquanto uma entrega feita com o pedido ainda em
 * producao e so um clique que faltou, e a equipe ja sabe dar esse clique.
 *
 * Por isso DM e pedido sao best-effort e devolvem o que aconteceu em vez de
 * lancar: quem esta na frente do comando precisa saber o que faltou, nao ver o
 * envio inteiro virar erro depois do arquivo ja ter saido.
 */
const logger = (0, Logger_1.createLogger)('delivery');
/** Cancelamento por tempo (o `AbortController` do cliente de anexo grande). */
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
const THREAD_TYPES = [
    discord_js_1.ChannelType.PublicThread,
    discord_js_1.ChannelType.PrivateThread,
    discord_js_1.ChannelType.AnnouncementThread,
];
/**
 * O topico por tras da conversa, quando ela for um.
 *
 * Decide pelo TIPO e nao por `channel.isThread()`: o guard precisa responder
 * sobre objetos que nao sao canais completos do discord.js (as fixtures dos
 * testes), e chamar um metodo neles estoura em vez de devolver false — a mesma
 * razao registrada em `isSendableConversation`.
 */
function asThread(channel) {
    return THREAD_TYPES.includes(channel.type) ? channel : null;
}
/**
 * O canal do ticket, conferido no momento do uso.
 *
 * TRES permissoes, e cada uma falha de um jeito diferente: sem `ViewChannel` o
 * Discord responde "Missing Access"; sem a de escrever, 403; sem `AttachFiles`
 * a mensagem sai SEM o arquivo — o cliente receberia um agradecimento vazio, e
 * ninguem perceberia ate ele perguntar onde esta o produto.
 *
 * A permissao de escrever tem NOME DIFERENTE em topico (`SendMessagesInThreads`)
 * e em canal (`SendMessages`). Conferir a errada reprovaria toda entrega em
 * ticket novo, que e topico privado.
 */
async function resolveDeliveryChannel(guild, channelId) {
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (!(0, discord_1.isSendableConversation)(channel)) {
        throw new errors_1.TicketStateError(`Canal do ticket indisponivel: ${channelId ?? 'nulo'}`, {
            userMessage: 'O canal deste atendimento não existe mais ou o bot perdeu acesso a ele.',
        });
    }
    const writeFlag = asThread(channel) !== null
        ? { flag: discord_js_1.PermissionFlagsBits.SendMessagesInThreads, label: 'Enviar mensagens em tópicos' }
        : { flag: discord_js_1.PermissionFlagsBits.SendMessages, label: 'Enviar mensagens' };
    const me = guild.members.me;
    const permissions = me === null ? null : channel.permissionsFor(me);
    const missing = [
        { flag: discord_js_1.PermissionFlagsBits.ViewChannel, label: 'Ver canal' },
        writeFlag,
        { flag: discord_js_1.PermissionFlagsBits.AttachFiles, label: 'Anexar arquivos' },
    ].filter((entry) => permissions === null || !permissions.has(entry.flag));
    if (missing.length > 0) {
        throw new errors_1.ConfigurationError(`Permissoes faltando no ticket ${channel.id}`, {
            userMessage: `O bot precisa de **${missing.map((entry) => entry.label).join('**, **')}** ` +
                'neste atendimento para entregar o arquivo. Avise um administrador.',
        });
    }
    return channel;
}
/**
 * Topico arquivado volta a ficar aberto antes do envio.
 *
 * Ticket parado 7 dias e arquivado pelo proprio Discord (`autoArchiveDuration`)
 * SEM deixar de estar aberto no banco — e producao de pack leva dias. Sem isto,
 * a entrega de um trabalho demorado falharia justamente no fim.
 *
 * Topico TRANCADO fica de fora: ele so e trancado no encerramento, e reabrir
 * para entregar num atendimento fechado seria contornar o encerramento.
 */
async function ensureWritable(channel) {
    const thread = asThread(channel);
    if (thread === null || thread.archived !== true)
        return;
    if (thread.locked === true) {
        throw new errors_1.TicketStateError(`Topico trancado: ${thread.id}`, {
            userMessage: 'Este atendimento está trancado. Reabra-o antes de entregar o produto.',
        });
    }
    await thread.setArchived(false, 'Entrega do produto');
}
/**
 * Sobe o arquivo para o Worker e devolve a URL publica.
 *
 * LANCA quando nao da. Aqui a hospedagem nao e enfeite: se ela falhar nao ha
 * como entregar o arquivo (ele ja nao cabe como anexo), e publicar o cartao com
 * um botao de download morto seria pior — o cliente leria que o produto esta
 * ali e clicaria num link que nao baixa nada.
 */
async function hostProduct(bytes, filename, format) {
    const url = await (0, AssetHostingService_1.hostAsset)({
        bytes,
        name: filename,
        contentType: format.mime,
        ext: format.ext,
        timeoutMs: (0, product_1.productTransferTimeoutMs)(bytes.length),
    });
    if (url === null) {
        throw new errors_1.ValidationError(`Hospedagem do produto indisponivel: ${bytes.length} bytes`, {
            userMessage: 'O arquivo não cabe como anexo neste servidor e a hospedagem da loja não respondeu. ' +
                'Tente de novo; se persistir, avise o administrador (Worker da Cloudflare) ou divida o pacote.',
        });
    }
    return url;
}
/**
 * Marca como ENTREGUE o pedido ligado ao atendimento.
 *
 * NUNCA LANCA: o arquivo ja esta com o cliente quando esta funcao roda. Uma
 * transicao recusada (o pedido mudou de estado entre a busca e o clique, ou
 * alguem ja o marcou) vira aviso para a equipe, que resolve no painel do pedido
 * em um clique.
 *
 * `notifyOrderDelivered` NAO e chamado de proposito: ele manda a DM de "pedido
 * entregue", e o cliente acabou de receber a DM da entrega com o arquivo. Duas
 * mensagens seguidas dizendo a mesma coisa e ruido. O aviso no canal de pedidos,
 * que e a parte util, vem pelo `refreshOrderNotice` aqui embaixo.
 */
async function markLinkedOrder(guild, staff, order) {
    try {
        const delivered = await (0, OrderService_1.deliverOrder)(guild.id, staff, order.id);
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, delivered);
        // O quadro de demandas tambem: entregue pelo ticket ou pelo painel, o
        // cartao precisa parar de dizer "em producao".
        await (0, DemandBoardService_1.refreshDemandCards)(guild, delivered);
        return { marked: true, warning: null };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn('Entrega feita, mas o pedido nao foi marcado como entregue.', {
            guildId: guild.id,
            entityType: 'order',
            entityId: order.id,
            userId: staff.id,
            detail,
        });
        return {
            marked: false,
            warning: error instanceof errors_1.ValidationError
                ? error.userMessage
                : 'O pedido não pôde ser marcado como entregue agora.',
        };
    }
}
/**
 * Registra a entrega no ticket e o leva para os concluidos.
 *
 * "Levar" porque o Discord nao move topico: o topico e arquivado (sai da lista
 * de ativos, sem fechar) e um cartao no canal de concluidos aponta para ele. Os
 * detalhes — e a regra de so arquivar se o cartao saiu — moram em
 * `announceTicketDelivered`.
 *
 * NUNCA LANCA: o arquivo ja esta com o cliente quando isto roda.
 */
async function moveTicketToDone(guild, ticket, staffId) {
    try {
        const delivered = await (0, TicketRepository_1.markTicketDelivered)(ticket.id, staffId);
        const result = await (0, TicketDoneService_1.announceTicketDelivered)(guild, delivered);
        // O cliente passa a ver o canal de entregas, onde o painel o leva de volta
        // a um topico que acabou de sair da lista lateral. Independe do cartao da
        // equipe: e o caminho do CLIENTE.
        await (0, TicketLocatorService_1.grantDeliveredLocatorAccess)(guild, ticket.ownerId);
        return result.carded;
    }
    catch (error) {
        logger.warn('Entrega feita, mas o ticket nao foi para os concluidos.', {
            guildId: guild.id,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Quem pode confirmar o recebimento, e se ainda da.
 *
 * Conferido ANTES do defer: sao leituras rapidas, e a resposta de "nao e voce"
 * ou "ja foi concluido" chega na hora, sem o "pensando..." na tela.
 *
 * SO O DONO DO TICKET. O botao fica num cartao que a equipe tambem ve, e o id
 * no customId identifica o ticket, nunca autoriza — quem clicou e conferido
 * aqui, pelo banco. A equipe que quiser encerrar sem a confirmacao usa o
 * "Finalizar" de sempre.
 *
 * Ticket ja fechado e o segundo clique esperado (o botao continua no cartao):
 * `TicketStateError` e recusa de regra, nao vira alerta.
 */
async function assertCanConfirmReceipt(guild, member, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.TicketNotFoundError(ticketId);
    }
    if (ticket.ownerId !== member.id) {
        throw new errors_1.PermissionError('Confirmacao de recebimento por quem nao e o cliente.', {
            userMessage: 'Só o cliente deste atendimento pode confirmar o recebimento.',
            context: { guildId: guild.id, userId: member.id, entityType: 'ticket', entityId: ticket.id },
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError(`Recebimento ja confirmado: ${ticket.id}`, {
            userMessage: 'Este atendimento já foi concluído. Obrigado!',
        });
    }
    return ticket;
}
/**
 * O cliente confirmou: o ticket fecha e o pedido e concluido.
 *
 * O TICKET FECHA PRIMEIRO, e e a unica parte que pode falhar alto. Se o
 * fechamento falhar, nada mudou — o cliente le o motivo e tenta de novo. Se o
 * pedido nao puder ser concluido depois, o atendimento continua fechado (que e
 * o que o cliente pediu) e a equipe conclui o pedido no painel dele.
 *
 * O fechamento e o de sempre (`closeTicket`): transcript, log, DM de
 * encerramento com o convite de avaliacao, topico trancado — e o cartao do
 * canal de concluidos passa a dizer "concluido pelo cliente".
 */
async function confirmReceipt(guild, member, ticket) {
    const closed = await (0, TicketCloseService_1.closeTicket)(guild, member, ticket.id, 'Recebimento confirmado pelo cliente.');
    const order = ticket.channelId === null
        ? null
        : await (0, OrderRepository_1.findOrderAwaitingConfirmation)(guild.id, ticket.channelId, ticket.ownerId).catch(() => null);
    if (order === null)
        return { orderLabel: null, orderCompleted: false, dmSent: closed.dmSent };
    const orderLabel = (0, OrderService_1.formatOrderNumber)(order.orderNumber);
    try {
        // Quem conclui e o proprio cliente: e o que a auditoria do pedido registra.
        const completed = await (0, OrderService_1.completeOrder)(guild.id, member, order.id);
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, completed);
        await (0, DemandBoardService_1.refreshDemandCards)(guild, completed);
        return { orderLabel, orderCompleted: true, dmSent: closed.dmSent };
    }
    catch (error) {
        logger.warn('Recebimento confirmado, mas o pedido nao foi concluido.', {
            guildId: guild.id,
            userId: member.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return { orderLabel, orderCompleted: false, dmSent: closed.dmSent };
    }
}
/**
 * Manda a copia da entrega na DM do cliente.
 *
 * NUNCA LANCA. DM fechada e o caso comum, nao um defeito — devolve `false` e o
 * cartao no ticket continua sendo a entrega valida.
 *
 * O TETO DE ANEXO EM DM E OUTRO: fora do servidor nao existe nivel de impulsos,
 * entao vale sempre o padrao de 20 MiB. Um arquivo de 50 MB que coube no ticket
 * de um servidor nivel 2 NAO cabe na DM — nesse caso ela vai sem o anexo,
 * dizendo onde o arquivo esta. Quando o arquivo foi hospedado, o botao de
 * download resolve os dois casos de uma vez.
 *
 * O envio usa o cliente de anexo grande (prazo longo, `retries: 0`) pelo mesmo
 * motivo do canal: o REST padrao desiste em 15 s e REPETE sozinho, e uma
 * repeticao depois de o Discord ja ter recebido o arquivo entregaria a mesma
 * DM duas vezes.
 */
async function sendDeliveryDm(params) {
    const fileAttached = params.file !== null && params.file.data.length <= limits_1.DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT;
    const root = (0, DeliveryBuilders_1.buildDeliveryDm)({
        ...params.card,
        ticketChannelId: params.ticketChannelId,
        fileAttached,
    });
    try {
        const dm = await params.customer.createDM();
        if (fileAttached && params.file !== null) {
            await (0, reply_1.sendV2WithLargeFile)({ id: dm.id, client: params.guild.client }, root, params.file);
        }
        else {
            await (0, reply_1.sendV2)(dm, root);
        }
        return { sent: true, hadFile: fileAttached, failure: null };
    }
    catch (error) {
        if ((0, discord_1.isDmBlockedError)(error) || (0, discord_1.isUnknownResourceError)(error)) {
            logger.warn('Cliente nao aceita DM; a entrega continua valendo pelo ticket.', {
                guildId: params.guild.id,
                userId: params.customer.id,
            });
            return { sent: false, hadFile: false, failure: 'fechada' };
        }
        /*
         * QUALQUER outra falha tambem para aqui, e essa e a parte que importa.
         *
         * Quando esta funcao roda, o cartao com o arquivo JA FOI publicado no
         * ticket e o cliente ja foi mencionado: a entrega aconteceu. Relancar um
         * 500 do Discord, uma queda de rede ou o proprio upload estourando o prazo
         * transformaria uma entrega feita em "erro inesperado" na tela da equipe —
         * com alerta no canal de erros, o pedido sem ser marcado, e a equipe
         * refazendo o formulario para mandar o MESMO pacote de novo.
         *
         * `error` e nao `warn`: DM fechada e rotina, isto aqui e defeito e precisa
         * aparecer no log com o motivo.
         */
        logger.error('Falha inesperada ao enviar a entrega por DM.', error, {
            guildId: params.guild.id,
            userId: params.customer.id,
        });
        return { sent: false, hadFile: false, failure: 'erro' };
    }
}
/**
 * Entrega o produto: cartao no ticket, copia na DM e pedido marcado.
 *
 * Sequencia: declaracao do arquivo -> ticket aberto -> canal -> download ->
 * formato pelos bytes -> envio. A ordem poe o que e barato primeiro: recusar um
 * arquivo grande demais nao pode custar a consulta ao canal, e recusar um canal
 * sem permissao nao pode custar o download.
 *
 * O ARQUIVO NUNCA FICA NA URL DO FORMULARIO: ela e assinada e expira em poucas
 * horas. Ele segue por um de dois caminhos, decididos pelo tamanho:
 *
 *  - CABE NO ANEXO (ate o limite do nivel de impulsos): vai como anexo da
 *    propria mensagem do bot. E o caminho preferido — o arquivo vive junto da
 *    mensagem, dentro do Discord, e nao depende de mais nada.
 *  - NAO CABE: sobe para o Worker da loja e o cartao ganha um botao de
 *    download. E o que permite entregar um pacote de 50 MB num servidor sem
 *    impulso; em troca, quem tiver o endereco baixa o produto sem passar pelo
 *    Discord — o endereco e aleatorio e nao esta em lugar nenhum, mas e a unica
 *    barreira.
 *
 * UMA TRANSFERENCIA POR VEZ, na fila compartilhada com o portfolio de lobos: o
 * arquivo e baixado inteiro e o reenvio faz mais uma copia (+208 MB de RSS
 * medidos para 100 MiB, num processo que o PM2 reinicia em 512 MB).
 */
async function deliverProduct(params) {
    const { guild, staff, ticket, customer, upload, maxBytes } = params;
    if (ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError(`Entrega em ticket inativo: ${ticket.id}`, {
            userMessage: 'Este atendimento não está mais ativo. Reabra-o para entregar o produto.',
        });
    }
    (0, product_1.assertProductDeclaration)(upload, maxBytes, (0, AssetHostingService_1.isAssetHostingEnabled)());
    return (0, TransferQueue_1.enqueueTransfer)(guild.id, async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const channel = await resolveDeliveryChannel(guild, ticket.channelId);
        await ensureWritable(channel);
        const download = await (0, download_1.downloadDiscordAttachment)(upload.url, maxBytes, (0, product_1.productTransferTimeoutMs)(upload.size));
        const format = (0, product_1.detectProductFormat)(download.bytes);
        if (format === null) {
            throw new errors_1.ValidationError(`Produto nao e arquivo compactado: ${upload.name}`, {
                userMessage: `O arquivo enviado não é um pacote ${(0, product_1.describeProductFormats)()}. ` +
                    'Compacte o produto e envie de novo.',
            });
        }
        /*
         * O nome do cliente e o que ele recebeu, entao ele sobrevive — mas com a
         * extensao do formato REAL. Um `.zip` que na verdade e RAR chegaria ao
         * cliente como um arquivo que o computador dele nao abre.
         */
        const base = (0, sanitize_1.sanitizeFilename)(upload.name.replace(/\.[A-Za-z0-9]{1,8}$/, ''), 'produto');
        const fileName = `${base}.${format.ext}`;
        const fileSize = (0, product_1.formatFileSize)(download.bytes.length);
        const startedAt = Date.now();
        /*
         * Anexo quando cabe; hospedagem quando nao cabe.
         *
         * O limite e do BOT neste servidor (nivel de impulsos), nao de quem
         * preencheu o formulario — quem tem Nitro sobe 500 MB pelo modal e o bot
         * continua limitado.
         */
        const asAttachment = download.bytes.length <= (0, product_1.discordProductLimit)(guild);
        const fileUrl = asAttachment
            ? `attachment://${fileName}`
            : await hostProduct(download.bytes, fileName, format);
        // O pedido e procurado ANTES do envio porque o numero dele aparece no
        // cartao; marcar, so depois de o arquivo ter saido.
        const order = ticket.channelId === null
            ? null
            : await (0, OrderRepository_1.findDeliverableOrderByChannel)(guild.id, ticket.channelId, customer.id);
        /*
         * Nao achou pedido DESTE cliente: sera que ha um de outra pessoa?
         *
         * "Nenhum pedido pago neste atendimento" e "voce entregou para a pessoa
         * errada" sao coisas muito diferentes, e sem esta consulta as duas sairiam
         * com a MESMA frase — a segunda escondendo o erro justamente de quem
         * poderia corrigi-lo. O select do formulario aceita qualquer usuario, e a
         * conta alternativa do cliente (ou um homonimo) e um clique de distancia.
         */
        const foreignOrder = order !== null || ticket.channelId === null
            ? null
            : await (0, OrderRepository_1.findDeliverableOrderInChannel)(guild.id, ticket.channelId);
        const card = {
            storeName: config.storeName,
            ticketId: ticket.id,
            customerId: customer.id,
            staffId: staff.id,
            ticketLabel: (0, TicketInternalPanelBuilder_1.formatTicketNumber)(ticket.ticketNumber),
            orderLabel: order === null ? null : (0, OrderService_1.formatOrderNumber)(order.orderNumber),
            fileName,
            fileSize,
            deliveredAt: new Date(),
            note: params.note,
            fileUrl,
            hosted: !asAttachment,
            guildId: guild.id,
            reviewChannelId: config.reviewChannelId,
        };
        const root = (0, DeliveryBuilders_1.buildDeliveryCard)(card);
        const file = { name: fileName, data: download.bytes, contentType: format.mime };
        let message;
        if (!asAttachment) {
            // Sem anexo: a mensagem e pequena e vai pelo caminho normal.
            const sent = await (0, reply_1.sendV2)(channel, root, { allowedMentions: (0, discord_1.mentionOnly)(customer.id) });
            message = { id: sent.id, channelId: sent.channelId };
        }
        else {
            try {
                message = await (0, reply_1.sendV2WithLargeFile)({ id: channel.id, client: guild.client }, root, file, { allowedMentions: (0, discord_1.mentionOnly)(customer.id) });
            }
            catch (error) {
                /*
                 * Envio cancelado por tempo.
                 *
                 * `retries: 0` impede a repeticao AUTOMATICA, mas nao a humana: sem
                 * esta traducao a equipe le "erro inesperado", refaz o formulario e
                 * entrega o MESMO arquivo duas vezes — e, pior, o segundo envio
                 * marcaria o pedido de novo. O aborto acontece justo no caso em que o
                 * Discord pode ja ter recebido o arquivo inteiro, entao a frase manda
                 * conferir o ticket ANTES de repetir.
                 */
                if (isAbortError(error)) {
                    logger.warn('Envio do produto cancelado por tempo.', {
                        guildId: guild.id,
                        channelId: channel.id,
                        userId: staff.id,
                        bytes: download.bytes.length,
                        uploadMs: Date.now() - startedAt,
                    });
                    throw new errors_1.ValidationError(`Envio do produto abortado: ${download.bytes.length} bytes`, {
                        userMessage: 'O envio do arquivo passou do tempo e foi cancelado. **Confira o ticket antes de entregar de novo** — ' +
                            'a mensagem pode ter sido criada mesmo assim.',
                    });
                }
                /*
                 * Recusa por tamanho — segunda linha de defesa.
                 *
                 * O teto por nivel de impulsos ja barra o arquivo ANTES do download,
                 * mas a tabela 50/100 MB vem da FAQ de impulsos, nao da referencia da
                 * API: se o Discord mudar, o reenvio volta a tomar 40005. Sem esta
                 * traducao, a equipe veria "erro inesperado" e o canal de alertas
                 * trataria como defeito do bot.
                 */
                if (!(0, discord_1.isPayloadTooLargeError)(error))
                    throw error;
                logger.warn('Discord recusou o produto por tamanho acima do teto calculado.', {
                    guildId: guild.id,
                    channelId: channel.id,
                    userId: staff.id,
                    bytes: download.bytes.length,
                    maxBytes,
                    premiumTier: guild.premiumTier,
                });
                throw new errors_1.ValidationError(`Produto recusado pelo Discord (40005): ${download.bytes.length} bytes`, {
                    userMessage: `O Discord recusou o arquivo por tamanho (${(0, product_1.describeProductMaxSize)(download.bytes.length)}). ` +
                        'O bot envia menos que isso neste servidor — divida o pacote em partes menores.',
                });
            }
        }
        const dm = await sendDeliveryDm({
            guild,
            customer,
            card,
            ticketChannelId: channel.id,
            file: asAttachment ? file : null,
        });
        const orderResult = order === null ? null : await markLinkedOrder(guild, staff, order);
        // POR ULTIMO, de proposito: arquivar o topico tira o ticket da lista de
        // ativos, e tudo que escreve nele (cartao, mencao) ja aconteceu acima.
        const ticketMoved = await moveTicketToDone(guild, ticket, staff.id);
        logger.info('Produto entregue no ticket.', {
            guildId: guild.id,
            channelId: channel.id,
            userId: staff.id,
            entityType: 'message',
            entityId: message.id,
            ticketNumber: ticket.ticketNumber,
            customerId: customer.id,
            bytes: download.bytes.length,
            format: format.ext,
            // Qual caminho o arquivo tomou: e a primeira pergunta quando o cliente
            // diz que nao consegue baixar.
            via: asAttachment ? 'anexo' : 'hospedagem',
            dmSent: dm.sent,
            orderMarked: orderResult?.marked ?? null,
            ticketMoved,
            uploadMs: Date.now() - startedAt,
        });
        return {
            message,
            fileName,
            fileSize,
            hosted: !asAttachment,
            dmSent: dm.sent,
            dmHadFile: dm.hadFile,
            dmFailure: dm.failure,
            orderLabel: card.orderLabel,
            orderMarked: orderResult?.marked ?? false,
            orderWarning: orderResult?.warning ?? null,
            foreignOrder: foreignOrder === null
                ? null
                : {
                    label: (0, OrderService_1.formatOrderNumber)(foreignOrder.orderNumber),
                    customerId: foreignOrder.customerId,
                },
            reviewChannelMissing: config.reviewChannelId === null,
            ticketMoved,
        };
    });
}
//# sourceMappingURL=DeliveryService.js.map