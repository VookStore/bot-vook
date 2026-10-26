import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';
import { catalogAdminButtons, catalogAdminModals, catalogAdminSelects } from './admin';
import {
  catalogCustomerButtons,
  catalogCustomerModals,
  catalogCustomerSelects,
} from './customer';

/**
 * Handlers do catalogo.
 *
 * As duas metades ficam em arquivos separados de proposito: a loja do cliente e
 * a administracao tem publicos, permissoes e riscos diferentes, e misturar as
 * duas em um arquivo so torna facil deixar passar um `assert` esquecido.
 */

export const catalogButtons: ButtonHandler[] = [
  ...catalogCustomerButtons,
  ...catalogAdminButtons,
];

export const catalogSelects: SelectHandler[] = [
  ...catalogCustomerSelects,
  ...catalogAdminSelects,
];

export const catalogModals: ModalHandler[] = [
  ...catalogCustomerModals,
  ...catalogAdminModals,
];

export { renderHomeForCommand, renderSearchResults } from './customer';
export { renderAdminPanelForCommand } from './admin';
