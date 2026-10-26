import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { TicketStatus, type Ticket } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Autorizacao das acoes que sairam de tras de um botao.
 *
 * O redesenho do painel administrativo tirou "adicionar membro", "remover
 * membro" e "transferir" de botoes proprios (cada um checava permissao antes de
 * abrir o seletor) e colocou os tres selects INLINE no painel. O componente
 * deixou de ser o portao: se algum destes caminhos passasse a confiar em "veio
 * do painel admin", qualquer membro que consiga acionar o customId mexeria no
 * ticket. Estes testes exercitam os handlers reais com um membro sem cargo
 * nenhum e exigem PermissionError ANTES de qualquer escrita.
 *
 * PermissionService e os services de ticket sao REAIS aqui — so o que fala com
 * o banco e com a API do Discord esta mockado.
 */

vi.mock('../src/components/reply', () => ({
  deferIfNeeded: vi.fn(() => Promise.resolve(undefined)),
  deferUpdateIfNeeded: vi.fn(() => Promise.resolve(undefined)),
  editReplyV2: vi.fn(() => Promise.resolve(undefined)),
  replyError: vi.fn(() => Promise.resolve(undefined)),
  replySuccess: vi.fn(() => Promise.resolve(undefined)),
  replyV2: vi.fn(() => Promise.resolve(undefined)),
  replyWarning: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  findTicketById: vi.fn(),
  touchRename: vi.fn(() => Promise.resolve(undefined)),
  transferTicketAtomic: vi.fn(() => Promise.resolve(true)),
  claimTicketAtomic: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../src/modules/tickets/repositories/TicketParticipantRepository', () => ({
  listActiveParticipants: vi.fn(() => Promise.resolve([])),
  isActiveParticipant: vi.fn(() => Promise.resolve(false)),
  countActiveParticipants: vi.fn(() => Promise.resolve(0)),
  addParticipant: vi.fn(() => Promise.resolve(undefined)),
  removeParticipant: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/tickets/services/TicketChannelService', () => ({
  grantChannelAccess: vi.fn(() => Promise.resolve(undefined)),
  revokeChannelAccess: vi.fn(() => Promise.resolve(undefined)),
  renameTicketChannel: vi.fn(() => Promise.resolve('ticket-0153')),
  resolveTicketChannel: vi.fn(() => Promise.resolve({ id: 'ch1', name: 'ticket-0153' })),
}));

vi.mock('../src/modules/tickets/services/TicketViewService', () => ({
  buildPanelForTicket: vi.fn(() => Promise.resolve({ toJSON: () => ({}) })),
  refreshInternalPanel: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../src/modules/tickets/services/TicketQueueService', () => ({
  refreshQueueHead: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/tickets/services/TicketConfigService', () => ({
  getCategoryById: vi.fn(() => Promise.resolve({ id: 'c1', name: 'Outros' })),
  getTeamRoleIds: vi.fn(() => Promise.resolve(['999999999999999999'])),
  getGuildTeamRoleIds: vi.fn(() => Promise.resolve(['999999999999999999'])),
}));

vi.mock('../src/modules/audit/repositories/AuditRepository', () => ({
  recordTicketAudit: vi.fn(() => Promise.resolve(undefined)),
  recordTicketTransfer: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: vi.fn(() => Promise.resolve({
    storeName: 'Vook Store',
    panelThumbnailUrl: null,
    panelBannerUrl: null,
    ticketBannerUrl: null,
    renameCooldownSeconds: 0,
  })),
}));

vi.mock('../src/modules/tickets/services/TicketCloseService', () => ({
  closeTicket: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/tickets/services/TicketCreationService', () => ({
  createTicketFlow: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/modules/tickets/services/TicketNotificationService', () => ({
  notifyClient: vi.fn(() => Promise.resolve({ dmSent: true })),
}));

import { PermissionError } from '../src/core/errors';
import { parseCustomId } from '../src/constants/customIds';
import { ticketButtons, ticketSelects } from '../src/interactions/tickets/index';
import { addParticipant, removeParticipant } from '../src/modules/tickets/repositories/TicketParticipantRepository';
import { findTicketById, transferTicketAtomic } from '../src/modules/tickets/repositories/TicketRepository';
import { grantChannelAccess, revokeChannelAccess } from '../src/modules/tickets/services/TicketChannelService';
import { buildPanelForTicket } from '../src/modules/tickets/services/TicketViewService';

const TICKET_ID = 'ckq1abc2xyz0000dadosaqui';
const GUILD_ID = '1528606501248438282';
const TEAM_ROLE = '999999999999999999';
const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const OUTSIDER = '444444444444444444';
const ALVO = '333333333333333333';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: TICKET_ID,
    guildId: GUILD_ID,
    ticketNumber: 153,
    categoryId: 'c1',
    ownerId: OWNER,
    subject: 'EMBED PAG',
    channelId: 'ch1',
    channelName: 'ticket-0153',
    status: TicketStatus.CLAIMED,
    priority: 'NORMAL',
    claimedById: STAFF,
    claimedAt: new Date(),
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: 'm1',
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Ticket;
}

/** Membro sem Administrator, sem Manage Guild e com os cargos que a lista disser. */
function makeMember(id: string, roleIds: readonly string[]): GuildMember {
  return {
    id,
    displayName: `Membro ${id}`,
    user: { id, tag: `user-${id}`, username: `user-${id}`, bot: false },
    permissions: { has: (_flag: bigint) => false },
    roles: { cache: { has: (roleId: string) => roleIds.includes(roleId) } },
    get guild() {
      return guild;
    },
  } as unknown as GuildMember;
}

const alvo = makeMember(ALVO, []);
const guild = {
  id: GUILD_ID,
  ownerId: '000000000000000000',
  client: { user: { id: '555555555555555555' } },
  members: {
    cache: { get: (id: string) => (id === ALVO ? alvo : undefined) },
    fetch: (id: string) => Promise.resolve(id === ALVO ? alvo : null),
  },
} as unknown as Guild;

const forasteiro = makeMember(OUTSIDER, []);
const atendente = makeMember(STAFF, [TEAM_ROLE]);

function buttonFor(action: string) {
  const handler = ticketButtons.find((b) => b.action === action);
  if (handler === undefined) throw new Error(`botao ${action} nao registrado`);
  return handler;
}

function selectFor(action: string) {
  const handler = ticketSelects.find((s) => s.action === action);
  if (handler === undefined) throw new Error(`select ${action} nao registrado`);
  return handler;
}

function parsed(customId: string) {
  const value = parseCustomId(customId);
  if (value === null) throw new Error(`customId invalido: ${customId}`);
  return value;
}

/** Interacao de select com o membro e o alvo escolhidos. */
function selectInteraction(member: GuildMember, valores: string[]) {
  return {
    guild,
    member,
    values: valores,
    deferred: false,
    replied: false,
    isStringSelectMenu: () => true,
    isUserSelectMenu: () => true,
  } as never;
}

function buttonInteraction(member: GuildMember) {
  return { guild, member, deferred: false, replied: false } as never;
}

function mutacoes() {
  return [addParticipant, removeParticipant, grantChannelAccess, revokeChannelAccess, transferTicketAtomic];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findTicketById).mockResolvedValue(makeTicket());
});

describe('selects inline do painel admin revalidam permissao no servidor', () => {
  it('adicionar membro: forasteiro e barrado antes de qualquer escrita', async () => {
    const handler = selectFor('add-select');
    await expect(
      handler.handle(selectInteraction(forasteiro, [ALVO]), parsed(`ticket:add-select:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);

    for (const spy of mutacoes()) expect(spy).not.toHaveBeenCalled();
  });

  it('remover membro: forasteiro e barrado antes de qualquer escrita', async () => {
    const handler = selectFor('remove-select');
    await expect(
      handler.handle(selectInteraction(forasteiro, [ALVO]), parsed(`ticket:remove-select:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);

    for (const spy of mutacoes()) expect(spy).not.toHaveBeenCalled();
  });

  it('transferir: forasteiro e barrado antes de qualquer escrita', async () => {
    const handler = selectFor('transfer-select');
    await expect(
      handler.handle(selectInteraction(forasteiro, [ALVO]), parsed(`ticket:transfer-select:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);

    for (const spy of mutacoes()) expect(spy).not.toHaveBeenCalled();
  });

  it('o mesmo select funciona para quem tem o cargo da categoria', async () => {
    await selectFor('add-select').handle(
      selectInteraction(atendente, [ALVO]),
      parsed(`ticket:add-select:${TICKET_ID}`),
    );
    expect(grantChannelAccess).toHaveBeenCalledTimes(1);
    expect(addParticipant).toHaveBeenCalledTimes(1);
  });

  it('perder o cargo invalida o painel que ja estava aberto', async () => {
    // Mesmo componente, mesmo customId; so o cargo do autor mudou.
    await selectFor('add-select').handle(
      selectInteraction(atendente, [ALVO]),
      parsed(`ticket:add-select:${TICKET_ID}`),
    );
    expect(addParticipant).toHaveBeenCalledTimes(1);

    const semCargo = makeMember(STAFF, []);
    vi.mocked(findTicketById).mockResolvedValue(makeTicket({ claimedById: null, status: TicketStatus.OPEN }));
    await expect(
      selectFor('add-select').handle(
        selectInteraction(semCargo, [ALVO]),
        parsed(`ticket:add-select:${TICKET_ID}`),
      ),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(addParticipant).toHaveBeenCalledTimes(1);
  });

  it('ticket de outra guild nao e alcancavel pelo customId', async () => {
    vi.mocked(findTicketById).mockResolvedValue(makeTicket({ guildId: '9999' }));
    await expect(
      selectFor('add-select').handle(
        selectInteraction(atendente, [ALVO]),
        parsed(`ticket:add-select:${TICKET_ID}`),
      ),
    ).rejects.toThrow();
    for (const spy of mutacoes()) expect(spy).not.toHaveBeenCalled();
  });
});

describe('painel interno e painel admin continuam fechados', () => {
  it('refresh nao renderiza os dados do ticket para quem nao e da equipe', async () => {
    await expect(
      buttonFor('refresh').handle(buttonInteraction(forasteiro), parsed(`ticket:refresh:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(buildPanelForTicket).not.toHaveBeenCalled();
  });

  it('refresh funciona para a equipe', async () => {
    await buttonFor('refresh').handle(
      buttonInteraction(atendente),
      parsed(`ticket:refresh:${TICKET_ID}`),
    );
    expect(buildPanelForTicket).toHaveBeenCalledTimes(1);
  });

  it('abrir o painel admin exige permissao', async () => {
    await expect(
      buttonFor('admin').handle(buttonInteraction(forasteiro), parsed(`ticket:admin:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('renomear exige permissao', async () => {
    await expect(
      buttonFor('rename').handle(buttonInteraction(forasteiro), parsed(`ticket:rename:${TICKET_ID}`)),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('o dono do ticket nao vira administrador do proprio atendimento', () => {
  const dono = makeMember(OWNER, []);

  it('nao adiciona membros', async () => {
    await expect(
      selectFor('add-select').handle(
        selectInteraction(dono, [ALVO]),
        parsed(`ticket:add-select:${TICKET_ID}`),
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('nao transfere o atendimento', async () => {
    await expect(
      selectFor('transfer-select').handle(
        selectInteraction(dono, [ALVO]),
        parsed(`ticket:transfer-select:${TICKET_ID}`),
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('nao usa o Administrator de outro servidor', () => {
    // Guarda de sanidade do fake: nenhum membro dos testes tem Administrator.
    for (const membro of [forasteiro, atendente, dono]) {
      expect(membro.permissions.has(PermissionFlagsBits.Administrator)).toBe(false);
    }
  });
});
