-- Desconto automatico de booster.
--
-- Cada degrau e um par (cargo, cupom). O desconto NAO e reimplementado aqui: o
-- cupom ja carrega tipo, valor, teto, minimo e limite de uso, e ja e validado
-- pelo modulo central na emissao da cobranca. O que se automatiza e a ESCOLHA
-- do cupom, nao o calculo.
--
-- Nulos = desconto automatico desligado (o padrao). Enquanto a loja nao apontar
-- cargo e cupom, nada e aplicado sozinho.
ALTER TABLE "guild_configs" ADD COLUMN "boosterRoleId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "boosterCouponId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "boosterTier2RoleId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "boosterTier2CouponId" TEXT;

-- Onde o desconto de booster NAO vale.
--
-- O anuncio publico exclui PEDs, roupas e props. Sem esta coluna a automacao
-- daria desconto justamente no que a loja disse que nao daria — pior que nao
-- automatizar, porque seria a propria loja quebrando o que anunciou.
--
-- Elegivel por padrao: uma categoria nova nasce valendo desconto, e tirar o
-- desconto e uma decisao explicita de quem administra o catalogo.
ALTER TABLE "catalog_categories" ADD COLUMN "boosterEligible" BOOLEAN NOT NULL DEFAULT true;
