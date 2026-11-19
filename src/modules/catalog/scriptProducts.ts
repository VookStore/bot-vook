/** Catálogo de apresentação: nenhuma destas ofertas gera cobrança nesta etapa. */
export const SCRIPT_CATALOG = [
    { product: 'pelucias_base', sku: 'VOOK-PLUSH-BASE', slug: 'sistema-pelucias-base', package: 'sistema-base',
        name: 'Sistema de Pelúcias · Base', category: 'Sistemas de Pelúcias',
        summary: 'Sistema completo, sem coleção de brinde. Instale as coleções que escolher.',
        description: 'Coleção, caixas, acessórios, trocas e administração em um único sistema. Catálogo inicial vazio para receber novas coleções. As artes promocionais dos dragões permanecem no menu. Inclui LEIA-ME de instalação, cadastro de coleções, raridades e pesos.',
        details: [['Entrega', 'Sistema padrão sem coleção de brinde'], ['Coleções', 'Instalação separada'], ['Painel', 'Preto e branco, com artes dos dragões']] },
    { product: 'pelucias_dragoes', sku: 'VOOK-PLUSH-DRAGONS', slug: 'sistema-pelucias-dragoes', package: 'sistema-dragoes',
        name: 'Sistema de Pelúcias · Dragões', category: 'Sistemas de Pelúcias',
        summary: 'Sistema completo com seis pelúcias de Como Treinar Seu Dragão de brinde.',
        description: 'Todos os recursos do sistema de pelúcias, mais seis dragões, caixa, imagens e modelos para equipar no corpo. O bônus é uma coleção de pelúcias; não anuncia pets animados de dragão. Inclui LEIA-ME próprio.',
        details: [['Entrega', 'Sistema padrão + bônus de seis dragões'], ['Modelos', 'Incluídos no pacote'], ['Painel', 'Preto e branco, com artes dos dragões']] },
    { product: 'companheiros_sanrio', sku: 'VOOK-COMP-SANRIO', slug: 'companheiros-sanrio', package: 'colecao-sanrio',
        name: 'Companheiros · Sanrio', category: 'Coleções de Companheiros',
        summary: 'Sete companheiros animados, painel rosa e modos box ou VIP no mesmo pacote.',
        description: 'Kuromi, Cinnamoroll, Keroppi, Hello Kitty, My Melody, Badtz-Maru e Pompompurin. Inclui modelos, animações, retratos, corpo inteiro, arte transparente da box e controle /pet independente. Box exige posse; VIP verifica a permissão do servidor. A escolha é configurável, sem pacote adicional.',
        details: [['Personagens', '7 companheiros animados'], ['Modalidades', 'Box ou VIP configurável no mesmo pacote'], ['Controle', '/pet independente, paleta rosa'], ['Instalação', 'LEIA-ME e integrações incluídos']] },
    { product: 'companheiros_monster_high', sku: 'VOOK-COMP-MH', slug: 'companheiros-monster-high', package: 'colecao-monster-high',
        name: 'Companheiros · Monster High', category: 'Coleções de Companheiros',
        summary: 'Dez companheiras animadas e controle independente, com box ou VIP configurável.',
        description: 'Draculaura, Frankie Stein, Clawdeen Wolf, Cleo de Nile, Lagoona Blue, Ghoulia Yelps, Abbey Bominable, Spectra Vondergeist, Operetta e Twyla. Modelos, animações, artes, caixa e /pet incluídos. Funciona como coleção independente e permite escolher box por posse ou acesso VIP por permissão.',
        details: [['Personagens', '10 companheiras animadas'], ['Modalidades', 'Box ou VIP configurável no mesmo pacote'], ['Controle', '/pet independente'], ['Instalação', 'LEIA-ME e integrações incluídos']] },
] as const;

export function isScriptPreview(pack: { sku?: string | null; slug?: string }): boolean {
    return SCRIPT_CATALOG.some(value => value.sku === pack.sku || value.slug === pack.slug);
}
export const SCRIPT_PREVIEW_NOTICE = 'Catálogo de apresentação. Compras e pagamentos destes produtos ainda não estão disponíveis.';

export const SCRIPT_IMAGES: Record<typeof SCRIPT_CATALOG[number]['product'], readonly string[]> = {
    pelucias_base: ['flyer-sistema-v2.png'],
    pelucias_dragoes: ['flyer-dragoes-v1.png', 'dragoes-box.png', ...['banguela', 'furiadaluz', 'tempestade', 'batatao', 'arrotaesoluca', 'alfa'].map(id => `dragao-${id}.png`)],
    companheiros_sanrio: ['flyer-sanrio-v2.png', 'sanrio-box.png', ...['kuromi', 'cinnamoroll', 'keroppi', 'hello_kitty', 'my_melody', 'badtz_maru', 'pompompurin'].map(id => `sanrio-${id}.png`)],
    // Draculaura é o destaque do flyer; as demais nove têm uma página individual.
    companheiros_monster_high: ['flyer-monster-high-v1.png', ...['frankie_stein', 'clawdeen_wolf', 'cleo_de_nile', 'lagoona_blue', 'ghoulia_yelps', 'abbey_bominable', 'spectra_vondergeist', 'operetta', 'twyla'].map(id => `monster-high-${id}.png`)],
};
