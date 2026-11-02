-- VOOK: arquivo exclusivamente do servidor. Nunca adicione a shared_scripts/files.
-- O endereço é preenchido pela VOOK ao preparar a distribuição.
local ENDPOINT = '__VOOK_LICENSE_ENDPOINT__'
local resource = GetCurrentResourceName()
local leaseUntil, stopped, pending = 0, false, false
local requestSerial = 0
local bootAt = os.time()
local keyConvar = resource .. '_license'
local key = GetConvar(keyConvar, '')
local installation = GetResourceKvpString('vook:license:installation')

local function randomId()
    local parts = {}
    for i = 1, 8 do parts[i] = ('%08x'):format(math.random(0, 0x7fffffff)) end
    return table.concat(parts)
end

if not installation or not installation:match('^[%w_-]+$') or #installation < 24 or #installation > 128 then
    installation = randomId()
    SetResourceKvp('vook:license:installation', installation)
end

PlushLicense = {}
function PlushLicense.allowed()
    return not stopped and os.time() < leaseUntil
end

local function stop(reason)
    if stopped then return end
    stopped, leaseUntil = true, 0
    print('[VOOK Auth][' .. resource .. '] ' .. reason .. ' O recurso será encerrado; as coleções permanecem salvas.')
    StopResource(resource)
end

local function validate()
    if stopped or pending then return end
    pending = true
    requestSerial = requestSerial + 1
    local serial = requestSerial
    local nonce = randomId()
    local sentAt = os.time()
    SetTimeout(10000, function()
        if pending and requestSerial == serial then
            pending = false
            requestSerial = requestSerial + 1 -- descarta resposta tardia
        end
    end)
    PerformHttpRequest(ENDPOINT, function(status, body)
        if stopped or serial ~= requestSerial then return end
        pending = false
        if status == 401 or status == 403 then stop('Autenticação recusada.') return end
        if status ~= 200 then return end -- erro transitório usa somente o lease já obtido
        local ok, data = pcall(json.decode, body or '')
        if not ok or type(data) ~= 'table' or data.nonce ~= nonce then return end
        if data.valid == false then
            local reasons = { expired = 'Licença vencida.', suspended = 'Licença suspensa.', server_mismatch = 'Licença vinculada a outro servidor.', invalid = 'Licença inválida.' }
            stop(reasons[data.reason] or 'Licença recusada.') return
        end
        if data.valid ~= true or type(data.leaseSeconds) ~= 'number' or data.leaseSeconds ~= data.leaseSeconds
            or data.leaseSeconds < 1 or data.leaseSeconds > 900 then return end
        local deadline = sentAt + math.floor(data.leaseSeconds)
        if type(data.expiresAt) == 'number' then deadline = math.min(deadline, data.expiresAt) end
        if deadline <= os.time() then return end
        local first = leaseUntil == 0
        leaseUntil = deadline
        if first then
            print('[VOOK Auth][' .. resource .. '] Licença validada. Sistema liberado.')
            TriggerEvent(resource .. ':licenseReady')
        end
    end, 'POST', json.encode({ product = 'pelucias', resource = resource, installation = installation, nonce = nonce }),
        { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. key }, { followLocation = false })
end

CreateThread(function()
    if not ENDPOINT:match('^https://[^/]+/v1/licenses/validate$') then stop('Configure o endereço HTTPS de autenticação.') return end
    if not key:match('^VOOK%-%x+$') or #key ~= 69 then stop('Configure set ' .. keyConvar .. ' no server.cfg.') return end
    if GetResourceKvpString('vook:license:installation') ~= installation then stop('Falha ao salvar o vínculo local.') return end
    local nextCheck = 0
    while not stopped do
        local now = os.time()
        if leaseUntil > 0 and now >= leaseUntil then stop('Prazo de validação esgotado. Confira a licença e a conexão.') return end
        if leaseUntil == 0 and now - bootAt >= 60 then stop('Não foi possível autenticar na inicialização.') return end
        if now >= nextCheck then
            validate()
            nextCheck = now + (leaseUntil == 0 and 10 or 120)
        end
        Wait(1000)
    end
end)
