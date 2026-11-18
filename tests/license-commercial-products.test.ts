import { readFileSync } from 'node:fs';
import { zipSync, type Unzipped } from 'fflate';
import { expect, it } from 'vitest';
import { PRODUCTS, commercialProducts } from '../src/modules/licenses/products';
import { inspectPackage, LICENSE_SLOT, archiveLimit } from '../src/modules/licenses/packages';
import { SCRIPT_CATALOG } from '../src/modules/catalog/scriptProducts';

function filesFor(product: typeof SCRIPT_CATALOG[number]['product']): Unzipped {
    const files: Unzipped = {
        'LEIA-ME.md': Buffer.from('Instalação da edição padrão.'),
        'vook_plush/LEIA-ME.md': Buffer.from('Instalação e modo box/VIP.'),
        'vook_plush/config.lua': Buffer.from("Config = { Inventory = { provider = 'ox_inventory' } }"),
        'vook_plush/edition.lua': Buffer.from("Config.Delivery = { mode = 'box' }"),
        'vook_plush/fxmanifest.lua': Buffer.from("fx_version 'cerulean'\ngame 'gta5'\nname 'vook_plush'\nversion '1.0.0'\nshared_scripts { 'config.lua', 'edition.lua' }\nserver_script 'server/license.lua'"),
        'vook_plush/server/license.lua': Buffer.from(readFileSync('integrations/fivem/license.lua', 'utf8')
            .replace('__VOOK_LICENSE_ENDPOINT__', 'https://vook-auth.shardweb.app/v1/licenses/validate')
            .replace("local key = GetConvar(keyConvar, '')", `local key = '${LICENSE_SLOT}'`)
            .replace("product = 'pelucias'", `product = '${product}'`)),
    };
    for (const bundle of PRODUCTS[product].bundles) {
        files[`${bundle}/fxmanifest.lua`] = Buffer.from(`fx_version 'cerulean'\ngame 'gta5'\nname '${bundle}'\nversion '1.0.0'\nfiles { 'stream/*.ytyp' }\ndata_file 'DLC_ITYP_REQUEST' 'stream/model.ytyp'`);
        files[`${bundle}/stream/model.ytyp`] = Buffer.from('<asset/>');
    }
    return files;
}
it.each(SCRIPT_CATALOG)('$name aceita só sua edição e dependências declaradas', offer => {
    const files = filesFor(offer.product), archive = zipSync(files);
    expect(Object.keys(inspectPackage(archive, offer.product, 'vook_plush', '1.0.0'))).toEqual(Object.keys(files));
    expect(() => inspectPackage(archive, offer.product, 'vook_plush_tb', '1.0.0')).toThrow();
    const other = SCRIPT_CATALOG.find(v => v.product !== offer.product)!;
    expect(() => inspectPackage(archive, other.product, 'vook_plush', '1.0.0')).toThrow();
    files['outra_colecao/stream/model.ytyp'] = Buffer.from('<asset/>');
    expect(() => inspectPackage(zipSync(files), offer.product, 'vook_plush', '1.0.0')).toThrow();
});
it('recusa coleção incompleta, versão FX inválida e código no pacote nativo', () => {
    const files = filesFor('companheiros_sanrio');
    delete files['vook_sanrio_hk/fxmanifest.lua'];
    expect(() => inspectPackage(zipSync(files), 'companheiros_sanrio', 'vook_plush', '1.0.0')).toThrow(/modelos/);
    const wrong = filesFor('pelucias_base');
    wrong['vook_plush/fxmanifest.lua'] = Buffer.from(Buffer.from(wrong['vook_plush/fxmanifest.lua']).toString().replace("fx_version 'cerulean'", "fx_version '1.0.0'"));
    expect(() => inspectPackage(zipSync(wrong), 'pelucias_base', 'vook_plush', '1.0.0')).toThrow(/cerulean/);
    const active = filesFor('companheiros_sanrio');
    active['vook_sanrio_hk/client/main.lua'] = Buffer.from('print(1)');
    expect(() => inspectPackage(zipSync(active), 'companheiros_sanrio', 'vook_plush', '1.0.0')).toThrow(/modelos/);
});
it('mantém legado privado e limites antigos sem vender TrueBlood', () => {
    expect(PRODUCTS.pelucias.resources).toContain('vook_plush_tb');
    expect(commercialProducts().some(([id]) => id === 'pelucias')).toBe(false);
    expect(commercialProducts().flatMap(([, p]) => [...p.resources])).not.toContain('vook_plush_tb');
    expect(archiveLimit('pelucias')).toBe(25 * 1024 * 1024);
    expect(archiveLimit('companheiros_monster_high')).toBe(128 * 1024 * 1024);
});
