import type { ContainerBuilder } from 'discord.js';

import {
  addHeader,
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { isSafeImageUrl } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';

/**
 * Cartao de boas-vindas (Components V2).
 *
 * Ordem: cabecalho com a LOGO DO SERVIDOR -> saudacao -> dados -> banner ->
 * contagem -> rodape.
 *
 * A miniatura e a logo da guild, e nao o avatar de quem entrou. O avatar ja
 * aparece ao lado da mensagem no Discord; repeti-lo dentro do cartao gastava o
 * unico espaco de marca que o cartao tem. E ela vai SEM texto alternativo: e a
 * marca do servidor, e anunciar "VOOK STORE — BOAS-VINDAS" duas vezes para quem
 * usa leitor de tela e ruido, nao acessibilidade.
 *
 * O BANNER FICA COLADO NA CONTAGEM. No topo ele empurrava a saudacao — a unica
 * linha dirigida a pessoa que acabou de entrar — para baixo da dobra no
 * celular. Entre os dados e a contagem ele fecha o cartao como um selo.
 *
 * LIMITE DO DISCORD: um Container aceita no maximo 10 componentes filhos.
 * O aviso de pre-visualizacao entra no MESMO TextDisplay da saudacao e a
 * contagem de membros no mesmo bloco dos dados — com banner e pre-visualizacao
 * ligados o cartao fica em 8 filhos, com folga. Blocos separados por divisor
 * levavam a 12 e a API recusava a mensagem inteira com 400.
 *
 * Funcao pura: nao acessa Discord, banco nem cache — recebe tudo pronto.
 */

export interface WelcomeCardData {
  /** Nome visual da loja (usado como descricao do banner). */
  storeName: string;
  /** ID do membro que entrou (usado na mencao e no rodape). */
  userId: string;
  /** Total de membros da guild no momento da entrada. */
  memberCount: number;
  /** Data de criacao da conta do Discord. */
  accountCreatedAt: Date;
  /** Momento em que o membro entrou no servidor. */
  joinedAt: Date;
  /** Banner configurado pela guild (pode ser nulo ou inseguro). */
  bannerUrl: string | null;
  /** Logo do servidor. Nulo quando a guild nao tem icone. */
  guildIconUrl: string | null;
  /** Quando verdadeiro, o cartao e apenas uma pre-visualizacao administrativa. */
  isPreview: boolean;
}

/** Contagem de membros formatada em pt-BR ("1.234"). */
function formatMemberCount(memberCount: number): string {
  const safe = Number.isFinite(memberCount) ? Math.max(0, Math.trunc(memberCount)) : 0;
  return safe.toLocaleString('pt-BR');
}

export function buildWelcomeCard(data: WelcomeCardData): ContainerBuilder {
  const root = container(COLORS.BRAND);

  addHeader(root, TITLES.WELCOME, {
    thumbnailUrl: isSafeImageUrl(data.guildIconUrl) ? data.guildIconUrl : null,
    // `null` explicito: a logo entra sem texto alternativo.
    thumbnailDescription: null,
  });

  const previewNotice = data.isPreview
    ? '⚠️ **PRE-VISUALIZACAO** — esta e uma amostra do cartao de boas-vindas.\n' +
      'Nenhum membro foi notificado e nenhum cargo foi aplicado.\n\n'
    : '';

  root.addTextDisplayComponents(
    text(`${previewNotice}${EMOJIS.WELCOME} Seja muito bem-vindo, <@${data.userId}>!`),
  );

  root.addSeparatorComponents(separator());

  root.addTextDisplayComponents(
    text(
      `**Conta criada** ${discordTimestamp(data.accountCreatedAt, 'R')}\n` +
        `**Entrou** ${discordTimestamp(data.joinedAt, 'F')}`,
    ),
  );

  if (isSafeImageUrl(data.bannerUrl)) {
    root.addMediaGalleryComponents(mediaGallery([data.bannerUrl as string], data.storeName));
  }

  root.addTextDisplayComponents(
    text(`📈 Agora somos **${formatMemberCount(data.memberCount)}** membros.`),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(footerNote(`ID: ${data.userId}`));

  return root;
}
