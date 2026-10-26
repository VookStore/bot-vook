import type { ContainerBuilder } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { COLORS } from '../../../constants/branding';
import {
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { formatCents } from '../../../utils/money';
import { isSafeImageUrl } from '../../../utils/sanitize';
import { PRICE_TABLE, type PriceLine, type PriceSection } from '../data/priceTable';

/**
 * Tabela de precos publica (Components V2).
 *
 * Mesma linguagem visual do painel de atendimento: banner primeiro, titulo como
 * chamada abaixo dele, blocos separados por divisoria e assinatura da equipe no
 * rodape.
 *
 * NAO TEM BOTAO. A tabela e material de consulta, nao um fluxo — quem decidir
 * comprar abre um ticket pelo painel de atendimento, que ja existe e ja e o
 * unico caminho de venda. Um botao aqui criaria uma segunda porta de entrada
 * para manter em pe.
 *
 * ORCAMENTO DE COMPONENTES. Um container aceita 10 filhos. Aqui: banner(1) +
 * divisoria(1) + cabecalho(1) + N blocos + divisoria(1) + rodape(1). Com os
 * quatro blocos atuais sao 9 — o teste fixa isso, entao um quinto bloco quebra
 * o teste em vez de virar um 400 no canal publico.
 */

/*
 * TEXTO DE CLIENTE VAI ACENTUADO.
 *
 * O resto do projeto escreve sem acento — identificadores, comentarios e log
 * sao ASCII de proposito. Isto aqui e outra coisa: e a vitrine de precos num
 * canal publico, e "Acessorios" e "Cilios" num cartaz de loja parecem descuido.
 * A regra vale so para o que o cliente le.
 */
const TITLE = 'TABELA DE PREÇOS';

const INTRO =
  'Valores de referência dos nossos serviços. Para encomendar, abra um ' +
  'atendimento pelo painel de tickets.';

const CLOSING =
  'Valores sujeitos a alteração. Trabalhos fora da tabela são orçados no atendimento.';

/**
 * Valor de uma linha, ja com prefixo, sufixo e moeda.
 *
 * O prefixo cola no valor quando e um simbolo (`+R$ 50,00`) e ganha espaco
 * quando e palavra (`a partir de R$ 180,00`). A alternativa seria guardar o
 * espaco dentro do dado — invisivel no arquivo e facil de perder num format.
 */
function renderValue(line: PriceLine): string {
  if (line.cents === null) {
    return line.instead ?? 'sob consulta';
  }

  const before =
    line.before === undefined ? '' : /[a-zà-ú]$/i.test(line.before) ? `${line.before} ` : line.before;
  const amount = `${before}${formatCents(line.cents)}`;

  return line.after === undefined ? amount : `${amount} ${line.after}`;
}

/** Um bloco: titulo com emoji e as linhas embaixo. */
export function renderSection(section: PriceSection): string {
  const heading = `### ${section.emoji} ${section.title}`;
  const lines = section.lines.map((line) => `• **${line.label}** — ${renderValue(line)}`);

  if (section.note !== undefined) {
    /*
     * A observacao e um APARTE quando ha precos acima dela (fica pequena, para
     * nao competir com os valores) e o CONTEUDO do bloco quando nao ha — caso
     * de "Roupas", que nao tem tabela e existe justamente para explicar por que.
     */
    lines.push(lines.length > 0 ? `-# ${section.note}` : section.note);
  }

  return [heading, ...lines].join('\n');
}

/**
 * Monta a tabela de precos.
 *
 * Reaproveita banner, miniatura e nome da loja da configuracao geral para nao
 * abrir um segundo conjunto de campos visuais so para esta mensagem.
 */
export function buildPricingPanel(config: GuildConfig): ContainerBuilder {
  const root = container(COLORS.BRAND);

  if (isSafeImageUrl(config.panelBannerUrl)) {
    root.addMediaGalleryComponents(
      mediaGallery([config.panelBannerUrl as string], config.storeName),
    );
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(text(`### ${TITLE}\n${INTRO}`));

  for (const section of PRICE_TABLE) {
    root.addTextDisplayComponents(text(renderSection(section)));
  }

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(footerNote(`${CLOSING} · Equipe ${config.storeName}`));

  return root;
}
