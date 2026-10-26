"use strict";
/** Limites reais da API do Discord e limites de negocio da Vook Store. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL = exports.TICKET_PRIORITY = exports.CART_REMINDER = exports.AUTO_ROLE_BACKFILL = exports.TRANSCRIPT_RETENTION = exports.ALERT = exports.SCHEDULER_INTERVALS = exports.BUSINESS_LIMITS = exports.DISCORD_LIMITS = void 0;
exports.DISCORD_LIMITS = {
    CUSTOM_ID: 100,
    CHANNEL_NAME: 100,
    MODAL_TITLE: 45,
    TEXT_INPUT_LABEL: 45,
    TEXT_INPUT_PLACEHOLDER: 100,
    TEXT_INPUT_SHORT_VALUE: 4000,
    SELECT_OPTIONS: 25,
    SELECT_LABEL: 100,
    SELECT_DESCRIPTION: 100,
    SELECT_PLACEHOLDER: 150,
    BUTTON_LABEL: 80,
    MESSAGE_CONTENT: 2000,
    /** Total de caracteres somando todos os TextDisplay de uma mensagem V2. */
    COMPONENTS_V2_TEXT_TOTAL: 4000,
    ACTION_ROWS_PER_MESSAGE: 5,
    BUTTONS_PER_ROW: 5,
    COMPONENTS_V2_TOP_LEVEL: 40,
    EMBED_TITLE: 256,
    EMBED_DESCRIPTION: 4096,
    EMBED_FOOTER_TEXT: 2048,
    EMBED_AUTHOR_NAME: 256,
    /**
     * Soma de titulo + descricao + rodape + autor + campos de UM embed.
     * O Discord recusa a mensagem inteira com 400 quando estoura — por isso o
     * anuncio confere o total antes de publicar, e nao depois.
     */
    EMBED_TOTAL: 6000,
    /**
     * Maior arquivo que o BOT consegue enviar em qualquer servidor: 20 MiB.
     *
     * Documentado em "Uploading Files" (docs.discord.com/developers/reference):
     * o padrao e 20 MiB por arquivo e so sobe pelo Nitro de quem envia ou pelo
     * nivel de impulsos do servidor. Bot nao tem Nitro, entao abaixo do nivel 2
     * este e o teto real — acima dele o Discord recusa com 40005.
     *
     * O `attachment_size_limit` das interacoes NAO serve de teto para o bot: a
     * mesma secao diz que ele e o MAIOR desses valores, o que inclui o Nitro de
     * quem clicou.
     */
    ATTACHMENT_BYTES_DEFAULT: 20 * 1024 * 1024,
    MESSAGES_FETCH_LIMIT: 100,
    AUTOCOMPLETE_CHOICES: 25,
};
/**
 * Maior arquivo que sobe para o Worker da loja.
 *
 * 95 MiB (~99,6 MB) fica logo abaixo dos 100 MB que o Cloudflare aceita como
 * corpo de requisicao nos planos Free e Pro. Passar disso trocaria a recusa
 * explicada por um 413 do Cloudflare no meio do envio.
 *
 * UM numero, dois nomes la embaixo: `WOLF_HOSTED_MAX_BYTES` e
 * `DELIVERY_HOSTED_MAX_BYTES` dizem ONDE ele vale, e quem trocar o plano do
 * Cloudflare troca aqui uma vez so.
 */
const HOSTED_ASSET_MAX_BYTES = 95 * 1024 * 1024;
/**
 * Teto DA LOJA para um arquivo que o bot rebaixa e reenvia: 100 MB.
 *
 * Nao e o teto que vale sempre — o Discord limita o anexo do BOT pelo nivel de
 * impulsos do servidor (20 MB ate o nivel 1, 50 MB no nivel 2, 100 MB no
 * nivel 3) e o bot usa o MENOR dos dois.
 *
 * O teto nao passa de 100 MB por causa da MEMORIA: o arquivo e baixado inteiro
 * e o discord.js faz mais uma copia para reenviar — medido em +208 MB de RSS
 * para 100 MiB, num processo que o PM2 reinicia em 512 MB.
 */
const TRANSFER_MAX_BYTES = 100 * 1024 * 1024;
exports.BUSINESS_LIMITS = {
    TICKET_SUBJECT_MIN: 5,
    TICKET_SUBJECT_MAX: 200,
    CLOSE_REASON_MAX: 900,
    REVIEW_COMMENT_MAX: 500,
    COUPON_CODE_MIN: 3,
    COUPON_CODE_MAX: 24,
    COUPON_DESCRIPTION_MAX: 200,
    CATEGORY_NAME_MAX: 60,
    /**
     * Maior URL de imagem aceita na configuracao.
     * Quem edita este numero precisa reavaliar `CONFIG_TEXT_LIMITS.IMAGES`, que e
     * derivado dele — o modal precisa caber as tres URLs de uma vez.
     */
    IMAGE_URL_MAX: 512,
    CATEGORY_DESCRIPTION_MAX: 100,
    PAYMENT_DESCRIPTION_MAX: 120,
    /** R$ 0,01 */
    PAYMENT_MIN_CENTS: 1,
    /** R$ 1.000.000,00 — teto de seguranca contra digitacao errada. */
    PAYMENT_MAX_CENTS: 100_000_000,
    PIX_RECEIVER_NAME_MAX: 25,
    PIX_CITY_MAX: 15,
    PIX_TXID_MAX: 25,
    MAX_CATEGORIES_PER_GUILD: 25,
    MAX_TEAM_ROLES_PER_CATEGORY: 10,
    MAX_PARTICIPANTS_PER_TICKET: 20,
    /** Quantos tickets do topo da fila podem ter o painel atualizado por vez. */
    QUEUE_PANEL_REFRESH_BATCH: 3,
    TRANSCRIPT_MAX_MESSAGES: 5000,
    QUEUE_PREVIEW_SIZE: 10,
    // --- Catalogo ---
    PACK_NAME_MAX: 80,
    PACK_SKU_MAX: 24,
    PACK_SHORT_DESCRIPTION_MAX: 140,
    PACK_DESCRIPTION_MAX: 1200,
    PACK_DETAIL_LABEL_MAX: 40,
    PACK_DETAIL_VALUE_MAX: 80,
    PACK_IMAGE_ALT_MAX: 100,
    MAX_IMAGES_PER_PACK: 10,
    MAX_DETAILS_PER_PACK: 10,
    MAX_PACKS_PER_GUILD: 500,
    MAX_CATALOG_CATEGORIES_PER_GUILD: 25,
    /** Packs listados por pagina do catalogo (limite real do select). */
    CATALOG_PAGE_SIZE: 20,
    /** Pedidos listados por pagina no historico do cliente e no painel da equipe. */
    ORDER_PAGE_SIZE: 5,
    MAX_CART_ITEMS: 15,
    MAX_ORDER_ITEMS: 15,
    CATALOG_SEARCH_MIN: 2,
    CATALOG_SEARCH_MAX: 60,
    /** Janela em que um pedido identico do mesmo cliente e tratado como duplicata. */
    ORDER_DUPLICATE_WINDOW_MS: 120_000,
    // --- Comprovante de pagamento ---
    /** Teto do arquivo enviado pelo cliente. */
    RECEIPT_MAX_BYTES: 8 * 1024 * 1024,
    MAX_RECEIPTS_PER_ORDER: 5,
    RECEIPT_COOLDOWN_SECONDS: 30,
    // --- Anuncios ---
    /**
     * Botoes de link por anuncio.
     *
     * Uma ActionRow aceita 5 botoes e uma mensagem aceita 5 rows, entao o teto
     * duro do Discord seria 25. O limite aqui e de PRODUTO: anuncio com mais de
     * dez links deixa de ser anuncio e vira menu, e o leitor no celular passa a
     * rolar botao em vez de ler o texto.
     */
    ANNOUNCE_MAX_BUTTONS: 10,
    ANNOUNCE_BUTTON_LABEL_MAX: 40,
    /** Texto do anuncio SEM embed — o teto de `content` de uma mensagem comum. */
    ANNOUNCE_PLAIN_MAX: 2000,
    /** Quanto tempo um rascunho sobrevive sem interacao. */
    ANNOUNCE_DRAFT_TTL_MS: 30 * 60_000,
    MAX_ANNOUNCE_DRAFTS: 200,
    // --- Portfolio de lobos ---
    WOLF_CUSTOMER_MAX: 80,
    /** Personalizacao e adicional: descricao curta, nao ficha tecnica. */
    WOLF_DETAIL_MAX: 400,
    /** Linhas por detalhe — alem disso o post vira lista e o render some da tela. */
    WOLF_DETAIL_MAX_LINES: 6,
    /**
     * Teto do render (ver `TRANSFER_MAX_BYTES`). So vale de fato num servidor
     * nivel 3 — ver `effectiveRenderLimit` e `guildUploadLimit`.
     */
    WOLF_RENDER_MAX_BYTES: TRANSFER_MAX_BYTES,
    /** Teto do render que sobe para o Worker em vez de virar anexo do Discord. */
    WOLF_HOSTED_MAX_BYTES: HOSTED_ASSET_MAX_BYTES,
    // --- Entrega do produto no ticket ---
    /**
     * Teto do arquivo do produto (ver `TRANSFER_MAX_BYTES`).
     *
     * Mesmo numero do render, e pela mesma razao — a memoria e do processo, nao
     * do recurso. A fila que serializa os dois e a mesma (`TransferQueue`).
     */
    DELIVERY_MAX_BYTES: TRANSFER_MAX_BYTES,
    /** Teto do produto que sobe para o Worker em vez de virar anexo do Discord. */
    DELIVERY_HOSTED_MAX_BYTES: HOSTED_ASSET_MAX_BYTES,
    /**
     * Observacoes da entrega: recado curto, nao manual de instalacao.
     *
     * E onde cabe a senha do arquivo e o "instale por ultimo" — por isso existe,
     * e por isso nao precisa ser grande.
     */
    DELIVERY_NOTE_MAX: 500,
    /** Linhas da observacao; alem disso o cartao da entrega vira parede de texto. */
    DELIVERY_NOTE_MAX_LINES: 8,
};
/** Intervalos dos jobs agendados (ms). */
exports.SCHEDULER_INTERVALS = {
    PAYMENT_EXPIRATION_MS: 60_000,
    MAINTENANCE_MS: 300_000,
    RECOVERY_MS: 900_000,
    PRIORITY_ESCALATION_MS: 300_000,
    /*
     * O backup e DIARIO; o job so roda de hora em hora para PERGUNTAR se ja
     * venceu. A pergunta e respondida pela data do dump mais novo no disco, entao
     * um intervalo curto nao gera backup extra — ele so garante que o dump saia
     * pouco depois de vencer, mesmo que o bot tenha reiniciado no meio.
     */
    BACKUP_CHECK_MS: 3_600_000,
    CART_REMINDER_MS: 1_800_000,
    /*
     * A retencao e DIARIA; a rodada de hora em hora so pergunta se ha vencido.
     * O lote e pequeno, entao perguntar com frequencia distribui a remocao em vez
     * de concentrar centenas de DELETEs numa unica passagem.
     */
    TRANSCRIPT_RETENTION_MS: 3_600_000,
    TWITCH_LIVE_CHECK_MS: 120_000,
};
/**
 * Retencao dos transcripts hospedados.
 *
 * O lote e pequeno de proposito: cada ticket vira uma chamada HTTP por anexo
 * mais uma pelo HTML, e o job roda ao lado do atendimento. Vale limpar devagar.
 */
/**
 * Alerta de erro no canal do Discord.
 *
 * A janela de agrupamento e o que separa "alerta util" de "canal silenciado":
 * um job quebrado a cada rodada produziria uma mensagem por minuto, e canal
 * silenciado nao alerta ninguem.
 */
exports.ALERT = {
    /** Tempo em que repeticoes do MESMO erro sao contadas em vez de publicadas. */
    WINDOW_MS: 10 * 60 * 1000,
    /** Teto da mensagem de erro dentro do bloco de codigo. */
    MAX_MESSAGE_CHARS: 900,
    /** Campos de contexto exibidos; o resto so interessa no log completo. */
    MAX_CONTEXT_FIELDS: 8,
};
exports.TRANSCRIPT_RETENTION = {
    BATCH: 25,
};
/**
 * Lembrete de carrinho abandonado.
 *
 * 24 horas e o intervalo classico de e-commerce: tempo suficiente para a pessoa
 * ter mesmo esquecido, e curto o bastante para a intencao de compra nao ter
 * evaporado. Nunca ha um segundo lembrete — a coluna `abandonedNoticeAt` e a
 * trava, e o custo de insistir seria o cliente bloquear as DMs do bot, levando
 * junto os avisos de cobranca, pagamento e entrega.
 */
/**
 * Aplicacao retroativa do cargo de boas-vindas.
 *
 * Os tetos existem porque a operacao roda DENTRO de uma interacao do Discord,
 * cujo token expira em 15 minutos. Estourar o tempo deixaria o operador sem
 * resposta nenhuma, sem saber quantos foram atendidos — pior que parar cedo e
 * dizer quantos faltam.
 */
exports.AUTO_ROLE_BACKFILL = {
    /** Membros por execucao. O que sobrar sai na proxima rodada do comando. */
    MAX_PER_RUN: 500,
    /** Espacamento entre escritas, para nao monopolizar a cota do bot. */
    SPACING_MS: 250,
    /** Teto de tempo, com folga sobre os 15 min do token da interacao. */
    BUDGET_MS: 10 * 60 * 1000,
    /** De quantos em quantos membros a mensagem de progresso e atualizada. */
    PROGRESS_EVERY: 50,
    /** Tentativas extras quando o gateway limita a listagem de membros. */
    FETCH_RETRIES: 2,
    /**
     * Espera maxima aceita do gateway antes de devolver o erro ao operador.
     *
     * O limite do opcode 8 escala a cada recusa (9,9s e depois 25,6s foram vistos
     * em producao). Aguardar minutos dentro de uma interacao gastaria o token de
     * 15 min sem garantia nenhuma — melhor dizer quantos segundos faltam.
     */
    MAX_RETRY_WAIT_S: 40,
    /** Margem somada ao retry_after: o relogio do gateway nao e o nosso. */
    RETRY_MARGIN_MS: 500,
};
exports.CART_REMINDER = {
    /** Inatividade do carrinho antes do lembrete. */
    ABANDONED_AFTER_MS: 24 * 60 * 60 * 1000,
    /** Carrinhos processados por rodada. */
    BATCH: 40,
    /** Respiro entre DMs; um lote em rajada bate no rate limit global. */
    DM_SPACING_MS: 1_500,
};
/**
 * Escalonamento automatico da fila.
 *
 * O campo `priority` sempre existiu e a fila sempre ordenou por ele, mas nada
 * nunca o definia: na pratica todo ticket era NORMAL e a ordenacao era so por
 * numero. Estes sao os dois degraus que o job aplica.
 *
 * VIP FICA DE FORA de proposito. Ele e reservado para quem tem pedido em aberto
 * — se a espera tambem levasse ate la, VIP deixaria de significar "cliente com
 * dinheiro em jogo" e viraria so "esperou bastante".
 */
exports.TICKET_PRIORITY = {
    /** Espera na fila para NORMAL virar HIGH. */
    HIGH_AFTER_MS: 15 * 60_000,
    /** Espera na fila para HIGH virar URGENT. */
    URGENT_AFTER_MS: 45 * 60_000,
    /** Teto de promocoes por degrau, por rodada. Segura o custo de uma fila represada. */
    ESCALATION_BATCH: 100,
};
exports.CACHE_TTL = {
    GUILD_CONFIG_MS: 600_000,
    CATEGORIES_MS: 600_000,
    TEAM_ROLES_MS: 600_000,
    COUPONS_MS: 300_000,
    PAYMENT_ACCOUNTS_MS: 600_000,
    CATALOG_CATEGORIES_MS: 600_000,
    CATALOG_PACKS_MS: 300_000,
    PACK_IMAGES_MS: 300_000,
};
//# sourceMappingURL=limits.js.map