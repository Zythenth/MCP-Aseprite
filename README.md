# Aseprite MCP Server

Servidor Model Context Protocol (MCP) de código aberto em TypeScript que conecta clientes de IA (como Google Gemini, Claude Desktop e outros clientes compatíveis com MCP) ao editor de pixel art Aseprite.

> [!NOTE]
> **Projeto Comunitário Não Oficial:** Este projeto é desenvolvido de forma independente pela comunidade e **não é afiliado, patrocinado ou endossado** pelos criadores do Aseprite (David Capello / Igara Studio S.A.).

O servidor permite inspecionar sprites, ler pixels, editar imagens, controlar camadas, frames e animações, validando cada alteração por meio de previews PNG gerados pelo motor do Aseprite. A comunicação com o Aseprite ocorre via WebSocket loopback local por meio de um script bridge em Lua, sem emulação de cliques de mouse e com políticas estritas de proteção de arquivos.

Fluxo principal:

```text
Observar -> analisar -> editar -> inspecionar novamente -> corrigir
```

---

## Recursos principais

- **Inspeção visual rica**: previews em PNG com escala nearest-neighbor, réguas de coordenadas e grades customizáveis.
- **Leitura precisa de pixels**: formatos hexadecimal (`#RRGGBBAA`), RGBA, indexado e compacto otimizado para economia de tokens.
- **Edição em lote e Undo atômico**: operações em lote agrupadas em uma única entrada de histórico de Undo.
- **138 ferramentas MCP tipadas**: pixels, formas, referências locais, arquivos, camadas/grupos, frames/tags, cels, slices, seleções, tilesets/tilemaps, preview animado, revisão visual, análise de pixel art, tween, smear, aprovação humana, pintura ao vivo, ações direcionais e exportação para engines.
- **Estrutura nativa do Aseprite**: cels vinculados, grupos aninhados, pivôs/nine-patch, blend modes, merge/flatten e exportação avançada por tag, intervalo e camada.
- **Ciclo visual incremental**: preview opcional após mutações, filmstrip, onion skin, comparação exata entre frames, checkpoints e histórico de alterações por revisão.
- **Qualidade de pixel art**: lint heurístico, CIEDE2000, análise de paleta, rampas com hue shift e dithering Bayer determinístico.
- **Segurança de arquivos**: contenção estrita de caminhos (`ASEPRITE_ALLOWED_PATHS`), política no-clobber por padrão (`overwrite: true` explícito) e validação de arquivo esperado no salvamento.
- **Bridge autenticável e versionado**: handshake obrigatório, sessão identificada, compatibilidade de protocolo verificada e token opcional (`ASEPRITE_BRIDGE_TOKEN`).
- **Superfície configurável**: modo somente leitura e seleção de toolsets para reduzir risco e custo de descoberta.
- **Mock Bridge em memória**: possibilita testes de integração rápidos e headless sem necessidade de abrir a interface do Aseprite.
- **Transporte padrão stdio**: mensagens de protocolo MCP isoladas em `stdout` e registros de diagnóstico em `stderr`.
- **Conexão persistente compartilhada**: um daemon local invisível mantém o único socket do Aseprite, enquanto todas as instâncias stdio entram como pares autenticados e podem abrir ou encerrar sem derrubar a conexão do editor.

---

## Arquitetura

```text
Cliente MCP (Gemini / Claude / outros)
    |
    | MCP sobre stdio
    v
Aseprite MCP Server (Node.js/TypeScript)
    |
    | par autenticado do daemon local
    v
Daemon persistente (Node.js; loopback por padrão)
    ^
    | iniciado pela extensão empacotada
Bridge Lua no Aseprite (aseprite-bridge.lua)
    |
    v
Documento ativo no Aseprite
```

O servidor registra as ferramentas MCP, valida parâmetros de entrada e encaminha comandos em envelopes correlacionados por ID ao bridge Lua. Antes de aceitar comandos, servidor e bridge concluem um handshake `hello`/`hello_ack` com versão, sessão, capacidades e revisão. Uma sessão reconectada pode pedir ressincronização e consultar alterações estruturadas desde uma revisão conhecida.

---

## Requisitos

- **Node.js**: versão 18.0.0 ou superior.
- **npm**: gerenciador de pacotes incluso no Node.js.
- **Aseprite**: versão v1.2.30+ ou v1.3+ com suporte à API WebSocket em Lua.
- **PowerShell**: para execução dos scripts de conveniência no Windows.

---

## Instalação rápida

### Usuário final: extensão recomendada

No Aseprite, abra **Edit > Preferences > Extensions > Add Extension** e selecione o arquivo `aseprite-mcp-bridge.aseprite-extension` distribuído com o projeto. Ao abrir o editor, a extensão inicia o bridge e o daemon local empacotado; a janela do editor passa por `Starting bundled MCP server`, `Connecting` e `Connected`.

Isso elimina copiar o Lua e abrir um terminal para iniciar o bridge. O Node.js continua necessário como runtime local, e o cliente de IA ainda precisa apontar para `dist/index.js` uma vez, conforme a seção de configuração do cliente MCP.

### Desenvolver ou empacotar a extensão

Clone o repositório e navegue até a pasta:

```bash
git clone https://github.com/Zythenth/MCP-Aseprite.git
cd MCP-Aseprite
```

### Windows (instalação de desenvolvimento ou script legado)

No PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

O script `install.ps1`:
1. Verifica Node.js >= 18 e npm;
2. Instala as dependências via `npm ci --ignore-scripts --no-audit --no-fund`;
3. Compila o projeto TypeScript gerando `dist/`;
4. Executa a suíte de testes (a menos que `-SkipTests` seja informado);
5. Verifica que servidor e bridge declaram a mesma versão de protocolo;
6. Copia `lua/aseprite-bridge.lua` para `%APPDATA%\Aseprite\scripts` caso o Aseprite seja detectado (ou se `-InstallLuaToAseprite` for fornecido) e confere o SHA-256 da cópia.

### Instalação manual (Todas as plataformas)

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

O ponto de entrada compilado será gerado em `dist/index.js`.

---

## Instalação do Bridge no Aseprite

### Extensão em um clique (recomendado)

Para gerar o pacote a partir do código-fonte, execute `npm run build` e `npm run package:extension`. O resultado é `dist/aseprite-mcp-bridge.aseprite-extension`. No Aseprite, use **Edit > Preferences > Extensions > Add Extension** e selecione esse arquivo. A extensão inclui o daemon compilado e a dependência WebSocket, inicia-o localmente quando o editor abre e mantém uma pequena janela com `Starting bundled MCP server`, `Connecting`, `Connected` ou reconexão. Não é necessário copiar Lua nem abrir um terminal para iniciar o bridge.

> A extensão não baixa executáveis: o runtime Node.js já instalado continua sendo um requisito. Use `ASEPRITE_NODE_PATH` somente se `node` não estiver no `PATH`. O daemon inicia no host/porta já configurados e permanece em loopback por padrão; ela não abre portas públicas.

### Script avulso (legado)

Caso o script não tenha sido copiado automaticamente pelo instalador:

1. Abra o Aseprite;
2. Acesse o menu **File > Scripts > Open Scripts Folder**;
3. Copie o arquivo `lua/aseprite-bridge.lua` para dentro da pasta aberta;
4. No Aseprite, clique em **File > Scripts > Rescan Scripts Folder**;
5. Execute **File > Scripts > aseprite-bridge**.

O diálogo do bridge exibirá o estado da conexão (`Connecting...`, `Connected` ou `Disconnected (Reconnecting...)`). Ele tenta se conectar ao servidor em `127.0.0.1:PORT` e reconecta automaticamente. Se a retomada nativa do WebSocket não abrir uma sessão em até seis segundos, o bridge substitui a conexão automaticamente; não é necessário clicar em **Reconnect**.

Inspeções de canvas e previews retornados pelas ferramentas de pintura são transportados em memória e não precisam gravar PNG temporário. Na primeira exportação ou preview temporal que precise gravar GIF/PNG, o Aseprite ainda pode pedir autorização de arquivo. Depois de conferir que o caminho exibido é exatamente o `aseprite-bridge.lua` instalado na pasta de scripts, marque **Give full trust to this script** e confirme **Give Script Full Access** para não repetir a confirmação a cada saída. Não conceda essa confiança a outro script ou a uma cópia cuja origem você não verificou.

> [!IMPORTANT]
> **Não edite o arquivo `lua/aseprite-bridge.lua` para alterar a porta.** A porta e o token de autenticação são lidos dinamicamente das variáveis de ambiente (`ASEPRITE_PORT` e `ASEPRITE_BRIDGE_TOKEN`). Como o Aseprite é um processo independente, configure essas variáveis no ambiente do sistema ou do usuário e reinicie o Aseprite.

---

## Configuração de Segurança e Ambiente

### 1. Política de Acesso a Arquivos (`ASEPRITE_ALLOWED_PATHS`)

Para impedir que comandos abram ou salvem arquivos fora das pastas do seu projeto, o servidor restringe operações de arquivo às raízes configuradas em `ASEPRITE_ALLOWED_PATHS`:

- **Formato**: lista de caminhos absolutos existentes separados por `;` no Windows ou `:` em ambientes POSIX.
- **Padrão**: caso a variável esteja ausente ou vazia, o servidor restringe o acesso ao diretório atual (`process.cwd()`), resolvido canonicamente via `realpath`.
- **Contenção e Symlinks**: links simbólicos que apontam para arquivos dentro das raízes permitidas são resolvidos e aceitos; links simbólicos que apontam para fora das raízes são bloqueados. Alvos de salvamento não podem ser symlinks existentes.
- **Extensões**: `.ase`, `.aseprite` e `.png` para leitura (`open_sprite`) e gravação (`save_sprite_as`); exclusivamente `.png` para `export_png`.
- **Proteção No-Clobber**: `save_sprite_as` e `export_png` nunca sobrescrevem arquivos existentes por padrão. Para sobrescrever intencionalmente, é necessário passar o parâmetro `overwrite: true`.
- **Salvamento Seguro (`save_sprite`)**: a ferramenta `save_sprite` não recebe caminho do usuário nem parâmetro de rota (é invocada sem argumentos). Ela opera diretamente sobre o arquivo já associado ao sprite ativo no Aseprite (`app.sprite.filename`). A validação de integridade `expectedFilePath` é realizada internamente pelo servidor MCP consultando `aseprite_status` antes de despachar o comando ao bridge Lua, que verifica a coincidência exata do caminho antes de executar o salvamento.

### 1.1. Raiz do projeto (`ASEPRITE_PROJECT_ROOT`)

`ASEPRITE_PROJECT_ROOT` define a base para caminhos relativos de referências, projetos e exports. Ela deve ser um diretório absoluto existente contido em uma das raízes de `ASEPRITE_ALLOWED_PATHS`; quando omitida, usa a primeira raiz autorizada.

- `references/heroi.png` é resolvido sob a raiz do projeto, nunca sob uma pasta arbitrária do computador.
- `find_reference_images` faz busca limitada por profundidade, quantidade de resultados e total de entradas; não percorre links simbólicos.
- `load_reference_image` aceita PNG, JPEG e WebP, valida tamanho e dimensões antes da decodificação e não altera o documento ativo.
- `save_project` grava somente `.aseprite`, preserva exatamente um nome fornecido e mantém no-clobber por padrão.

### 2. Autenticação por Token no WebSocket (`ASEPRITE_BRIDGE_TOKEN`)

Por padrão, o bridge conecta-se localmente em `127.0.0.1`. Para adicionar uma barreira extra contra acessos locais não autorizados de outros softwares rodando na máquina:

- **Formato**: token de 16 a 128 caracteres contendo apenas caracteres URL-safe ASCII (`[A-Za-z0-9._~-]`).
- **Geração**: gere um token seguro de 32 bytes aleatórios executando:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```
- **Configuração no Aseprite (Windows)**:
  Como o Aseprite é executado separadamente, defina as variáveis no nível do usuário:
  ```powershell
  [Environment]::SetEnvironmentVariable("ASEPRITE_PORT", "32123", "User")
  [Environment]::SetEnvironmentVariable("ASEPRITE_BRIDGE_TOKEN", "seu-token-gerado", "User")
  ```
  Após definir, reinicie o Aseprite e o cliente MCP para carregar as novas variáveis.
- **Validação e Privacidade**: a validação é feita em tempo constante (`crypto.timingSafeEqual`). O token **nunca** é impresso em logs, console, diálogos ou mensagens de erro. A interface do Aseprite exibe apenas `[Auth: enabled]` ou `[Auth: disabled]`.
- **Aviso**: conexões no loopback e tokens de autenticação mitigam conexões acidentais ou não autorizadas no host local, mas não eliminam todos os riscos em sistemas compartilhados. Se nenhum token for configurado, o servidor emitirá um aviso único na inicialização indicando que a autenticação no loopback está desabilitada.

O token não é colocado na URL. Ele é enviado somente no primeiro envelope de handshake. O servidor fixa o primeiro bridge autenticado e pronto como cliente ativo; conexões candidatas não substituem uma sessão ativa.

### 3. Modo somente leitura e toolsets

- `ASEPRITE_READ_ONLY=1` não registra ferramentas que alteram o sprite ou gravam arquivos. Inspeção, análise e abertura de documento permanecem disponíveis.
- `ASEPRITE_TOOLSETS` recebe uma lista separada por vírgulas. Valores aceitos: `core`, `visual`, `editing`, `files`, `shapes`, `layers`, `frames`, `palette`, `cels`, `slices`, `selection`, `tiles`, `animation`, `pixel-art` e `review`.
- `core` (`aseprite_status`) é sempre incluído. O valor ausente, vazio ou `all` ativa todos os conjuntos.

Exemplo enxuto para um agente revisor:

```powershell
.\start.ps1 -ReadOnly -Toolsets visual,palette,animation,pixel-art,review
```

### 4. Agente em VM, WSL ou LAN privada

O padrão é sempre loopback. Para um agente em VM/WSL/LAN, habilite explicitamente `ASEPRITE_REMOTE_MODE=true`, use um `ASEPRITE_HOST` IPv4 privado (somente `10/8`, `172.16/12` ou `192.168/16`), um token de pelo menos 32 caracteres e uma allowlist de IPs privados em `ASEPRITE_REMOTE_PEERS`. O bridge rejeita bind público, wildcard e DNS, e o daemon rejeita qualquer cliente que não esteja na allowlist mesmo com token válido.

```powershell
$env:ASEPRITE_REMOTE_MODE = "true"
$env:ASEPRITE_HOST = "192.168.1.10"
$env:ASEPRITE_REMOTE_PEERS = "192.168.1.42"
$env:ASEPRITE_BRIDGE_TOKEN = "gere-um-token-url-safe-com-pelo-menos-32-caracteres"
```

Não configure encaminhamento de porta no roteador. Para redes fora da LAN, use uma VPN privada que forneça endereços privados e inclua o IP do agente na allowlist.

### 4. Limites operacionais

O servidor limita payloads do bridge, comandos pendentes, dimensões de canvas, pixels por lote, frames de filmstrip/spritesheet, tamanho do checkpoint e cardinalidade da análise de paleta. Esses limites são proteções contra consumo acidental de memória/CPU; não constituem uma sandbox para processos locais já comprometidos.

---

## Configuração do Cliente MCP

### Exemplo Mínimo (Padrão)

No arquivo de configuração do seu cliente MCP (por exemplo, `gemini-mcp-config.json` ou configuração do Claude Desktop):

```json
{
  "mcpServers": {
    "aseprite": {
      "command": "node",
      "args": [
        "C:/caminho/para/MCP-Aseprite/dist/index.js"
      ],
      "env": {
        "ASEPRITE_PORT": "32123",
        "ASEPRITE_ALLOWED_PATHS": "C:/Projetos/PixelArt",
        "ASEPRITE_PROJECT_ROOT": "C:/Projetos/PixelArt"
      }
    }
  }
}
```

### Exemplo Endurecido (Com Token e Múltiplas Raízes)

> [!NOTE]
> O valor `"SubstituaPeloSeuTokenAleatorio12345"` abaixo é um marcador de posição demonstrativo com charset URL-safe válido (`[A-Za-z0-9._~-]`, entre 16 e 128 caracteres). Substitua-o pelo token seguro gerado no seu ambiente.

```json
{
  "mcpServers": {
    "aseprite": {
      "command": "node",
      "args": [
        "C:/caminho/para/MCP-Aseprite/dist/index.js"
      ],
      "env": {
        "ASEPRITE_PORT": "32123",
        "ASEPRITE_ALLOWED_PATHS": "C:/Projetos/PixelArt;D:/Assets/Sprites",
        "ASEPRITE_PROJECT_ROOT": "C:/Projetos/PixelArt",
        "ASEPRITE_BRIDGE_TOKEN": "SubstituaPeloSeuTokenAleatorio12345"
      }
    }
  }
}
```

### Skill de projeto para Gemini/Antigravity

O repositório inclui a skill `aseprite` em `.agents/skills/aseprite/SKILL.md`. O Antigravity descobre automaticamente skills de workspace versionadas quando o projeto é aberto pela raiz, permitindo que todas as pessoas que clonarem o repositório usem o mesmo fluxo seguro de criação, revisão e salvamento.

Depois de conectar o servidor MCP `aseprite`, atualize as customizações ou reinicie o Antigravity e inicie o pedido com:

```text
/aseprite

Crie uma animação no Aseprite usando exclusivamente as ferramentas aseprite/.
```

A skill proíbe o uso de Python, terminal e scripts auxiliares para gerar pixels, exige edição por coordenadas explícitas, preview, análise temporal, revisão e verificação dos arquivos finais. Ela complementa as instruções enviadas automaticamente pelo próprio servidor MCP.

> [!IMPORTANT]
> **Várias conversas compartilham o mesmo bridge persistente.** A extensão inicia o daemon local ao abrir o Aseprite; cada cliente stdio mantém sua própria sessão MCP e entra como par desse daemon. O daemon permanece ativo depois que as conversas terminam, portanto o socket do Aseprite não é derrubado quando uma tarefa fecha. Novas conversas apenas reutilizam a conexão existente. Uma porta ocupada por outro programa ou um token divergente continua sendo rejeitada e reavaliada automaticamente.

---

## Execução Manual e Scripts

Para diagnóstico standalone (não junto com um cliente MCP configurado), execute:

```bash
npm start
```

No Windows via PowerShell:

```powershell
# Execução standalone explícita
.\start.ps1 -ManualBridgeServer

# Especificando porta, diretórios autorizados e a raiz para caminhos relativos
.\start.ps1 -ManualBridgeServer -Port 32123 -AllowedPaths @("C:\Projetos\PixelArt") -ProjectRoot "C:\Projetos\PixelArt"

# Execução com Mock Bridge (headless, sem Aseprite)
.\start.ps1 -ManualBridgeServer -Mock

# Revisão sem mutações, expondo apenas conjuntos necessários
.\start.ps1 -ManualBridgeServer -ReadOnly -Toolsets visual,palette,animation,pixel-art,review
```

> [!TIP]
> **Segurança de Segredos no Terminal:** Evite passar `-BridgeToken` como argumento de linha de comando para não gravar segredos no histórico do shell (`Get-History`, `.bash_history`) ou na listagem de processos do sistema. Prefira sempre definir a variável de ambiente `$env:ASEPRITE_BRIDGE_TOKEN` na sessão do terminal ou nas variáveis de ambiente de usuário antes de executar o script.

---

## Resumo das Ferramentas MCP

O conjunto completo contém **138 ferramentas únicas**. Para reduzir o contexto enviado ao modelo, exponha somente os toolsets necessários.

### Inspeção Visual e Leitura
- `aseprite_status`: Estado da conexão, arquivo ativo, tamanho do canvas, camada e frame selecionados e revisão atual.
- `get_sprite_info`: Estrutura hierárquica de camadas, frames, opacidades e blend modes.
- `inspect_sprite`: Preview PNG combinado com matriz de dados de pixels.
- `get_canvas`: Renderiza o canvas completo ou uma camada isolada como PNG.
- `get_pixel_grid`: Extração matricial de pixels (formatos hex, rgba ou compact).
- `get_pixel_grid_preview`: Visualização ampliada com réguas de coordenadas e grade de pixels.

### Edição de Pixels e Formas
- `set_pixels`: Aplicação de pixels em lote com Undo atômico.
- `set_pixel`: Aplicação de pixel único.
- `erase_pixels`: Limpeza de pixels para transparência (`#00000000`).
- `draw_line`, `draw_rectangle`, `draw_ellipse`: Rasterização de formas geométricas.
- `flood_fill`, `replace_color`: Preenchimento por tolerância e substituição de cores.
- `undo`, `redo`: Controle do histórico de edição.

### Camadas, grupos e composição

- Básico: `list_layers`, `create_layer`, `rename_layer`, `delete_layer`, `select_layer`, `set_layer_visibility`, `set_layer_opacity`, `move_layer`, `create_group`.
- Hierarquia: `list_layer_tree`, `move_layer_to_group`, `ungroup_layer`.
- Composição: `set_layer_blend_mode`, `merge_down_layer`, `flatten_layers`.

### Frames, tags e inspeção de animação

- Frames/tags: `list_frames`, `select_frame`, `create_frame`, `duplicate_frame`, `move_frame`, `delete_frame`, `set_frame_duration`, `set_frame_durations`, `create_tag`, `list_tags`, `update_tag`, `delete_tag`.
- Revisão: `get_onion_skin`, `get_filmstrip`, `compare_frames`, `inspect_animation`, `render_animation_preview`.
- `inspect_animation` combina frames, durações, tags, repetição, ordem efetiva de playback, camadas e cobertura de cels em uma resposta estruturada.
- `render_animation_preview` retorna primeiro um GIF reproduzível e depois um contact sheet PNG na mesma ordem temporal, com `previewId`, timing, FPS médio e revisão observada.
- Tags aceitam `forward`, `reverse`, `pingpong` e `pingpong_reverse`; `repeats: 0` representa loop contínuo.

### Cels, slices e seleções

- Cels: `get_cel`, `create_cel`, `copy_cel`, `move_cel`, `delete_cel`, `set_cel_position`, `set_cel_opacity`, `link_cel`, `unlink_cel`. Por segurança, `move_cel` move o cel entre frames da mesma camada; para copiar entre camadas, use `copy_cel`.
- Slices: `list_slices`, `get_slice`, `create_slice`, `update_slice`, `delete_slice`, incluindo centro nine-patch e pivô.
- Seleção persistente: `get_selection`, `set_selection`, `clear_selection`, `invert_selection`. `set_selection` oferece substituição, união, subtração e interseção retangulares.

### Tilesets e tilemaps

- `list_tilesets`, `create_tileset`, `delete_tileset`, `get_tile`, `set_tile_pixels`.
- `create_tilemap_layer`, `get_tilemap`, `set_tiles`, incluindo índices e flags de espelhamento X/Y/diagonal.

### Pixel art, checkpoints e waivers

- `lint_pixel_art`: encontra indícios de pixels órfãos, outline interrompido, banding, pillow shading, drift de simetria e seams. Resultados são heurísticos e nunca corrigidos automaticamente.
- `analyze_palette`, `find_perceptual_palette_color`, `generate_palette_ramp`, `apply_ordered_dither`.
- `create_review_checkpoint`, `list_review_checkpoints`, `compare_review_checkpoint`, `delete_review_checkpoint`.
- `add_lint_waiver`, `list_lint_waivers`, `delete_lint_waiver`. Checkpoints e waivers são vinculados à sessão atual e mantidos apenas em memória.

### Workflow de animação e edição atômica

- `batch_animation_edits` valida antecipadamente uma lista fechada de operações de pixels, posição/opacidade de cel e duração; uma execução efetiva forma uma única transação de Undo e respeita limites de payload, operações, frames e pixels.
- O workflow estruturado registra a referência carregada e sua análise, plano e key poses, preview da revisão atual, revisão das poses, autoavaliação nas 22 categorias e QA independente (`reviewerId` diferente de `authorId`).
- `analyze_animation_temporal` produz achados temporais determinísticos e limitados, com hash da seleção/revisão analisada.
- Qualquer mutação invalida previews e revisões anteriores. Achados críticos abertos, achados altos não tratados, QA ausente/reprovada ou evidência obsoleta impedem a conclusão.
- `create_pixel_art_tween` gera intermediários entre duas poses-chave movendo clusters 4-conectados da mesma cor; não mistura alfa, redimensiona ou suaviza pixels. Os frames produzidos exigem inspeção com `get_canvas`, preview temporal e QA.
- `create_smear_frame` insere um único frame de smear nítido entre keyframes normais, calculando a direção a partir dos limites ocupados e preservando as poses original e final.
- `request_human_approval` abre um diálogo nativo no Aseprite com preview, `Aprovar`, `Pedir alterações` e `Rejeitar`. O recibo aprovado pode ser exigido antes de um export final.

### Ações direcionais

- `plan_directional_animation` compõe o plano para caminhada, corrida, idle, ataque corpo a corpo/à distância, hit, morte, dash, cast e interação em 4 ou 8 direções. Ele produz nomes de tags, timing, poses, eventos de engine e critérios de QA com base em frames, FPS, passada e estilo; hit aceita opcionalmente força máxima de recoil e tipo de dano.
- `create_directional_animation_timeline` duplica uma pose-base para criar os slots editáveis de cada direção e suas tags. Os slots não são declarados como arte final: o agente deve desenhar as poses indicadas antes da revisão.
- `generate_directional_animation_from_key_poses` cria automaticamente todos os frames finais para cada direção a partir de duas ou mais poses-chave já desenhadas para aquela direção. Ele preserva pixels nítidos com interpolação de clusters 4-conectados da mesma cor, registra quais intermediários foram produzidos e pede inspeção visual antes do export.
- `analyze_directional_animation` verifica tags, timing, frames repetidos, bounds, jitter, paleta, loop, pontos exatos de contato para detectar foot sliding, contatos contra uma linha de chão, amplitude vertical e trilhas explícitas das duas mãos para confirmar balanço alternado. Na corrida, `walkReference` verifica que FPS e passada superam os da caminhada, e `walkContactFrameCount` comprova contato com o chão mais curto.
- `assess_directional_mirroring` exige uma decisão explícita para espada em uma mão, texto, cicatrizes, iluminação ou equipamento assimétrico. `mirror_directional_animation` só espelha depois dessa aprovação e cria um novo tag sem sobrescrever o original.
- Os eventos retornados pelo plano (`impact`/`shot`, `final_pose`, `dash_*`, `cast_*` e `interaction_contact`) incluem os frames por direção e podem ser encaminhados diretamente ao parâmetro `events` de `export_engine_assets`.
- Interações exigem `targetHeightPx`, `targetOffsetX` e `targetOffsetY`, evitando templates cegos para objetos em alturas ou posições diferentes.

### Modo pintura ao vivo

- `start_live_painting` inicia um processo observável e devolve o PNG inicial. Ele aceita as etapas `sketch`, `blocks`, `silhouette`, `line`, `base_colors`, `shadows`, `details` e `polish`, além de velocidade e modo comentário.
- Para cada etapa, o agente deve chamar `begin_live_painting_stage`, fazer exatamente uma mutação atômica no Aseprite e chamar `complete_live_painting_stage`. A conclusão retorna o PNG atualizado, de modo que a construção fica visível no canvas e registrada no log.
- `pause_live_painting`, `continue_live_painting`, `cancel_live_painting`, `set_live_painting_speed` e `undo_live_painting_stage` fornecem os controles do processo. Enquanto ativo, o MCP bloqueia edições fora da etapa aberta; cada etapa contém uma única transação do Aseprite para que o Undo da etapa seja seguro. Cancelar não apaga silenciosamente a arte já feita.
- `get_live_painting_status`, `list_live_painting_snapshots`, `get_live_painting_snapshot` e `render_live_painting_replay` permitem acompanhar e revisar o log visual. Os snapshots ficam apenas em memória, até 16 imagens e 64 MiB por processo, e são descartados se a conexão ou o documento mudar.
- A velocidade é uma recomendação de espaçamento entre snapshots visíveis: `slow` 900 ms, `normal` 350 ms e `fast` 100 ms. Com `commentaryMode: true`, cada etapa exige uma explicação curta do agente.

### Arquivos e exportação

- `find_reference_images`: localiza PNG, JPEG e WebP por nome somente em diretórios autorizados, com busca recursiva limitada.
- `load_reference_image`: retorna a imagem de referência, dimensões, formato, transparência, hash e análise de paleta sem trocar o sprite ativo.
- `new_sprite`, `open_sprite`, `save_sprite`, `save_sprite_as`, `save_project`, `export_png`, `resize_canvas`.
- `export_sprite_sheet`: exporta por tag ou intervalo explícito, filtra camadas e organiza frames horizontalmente, verticalmente ou em grade, respeitando direção da tag, escala, espaçamento e no-clobber.
- `export_animation`: exporta a ordem efetiva de uma tag ou intervalo como GIF, spritesheet, sequência PNG ou PNG único. A sequência PNG usa nomes determinísticos e remove arquivos novos já escritos se uma execução no-clobber falhar parcialmente. Com `final: true`, o gate é aplicado quando o workflow ativo exige conclusão estrita ou quando `strictWorkflowValidation: true`; o resultado aceito inclui evidência compacta vinculada à revisão, preview, revisão das poses, autoavaliação e QA atuais.
- `export_engine_assets`: gera um spritesheet PNG, `SpriteFrames` do Godot (`.tres`) e metadata de importação Unity (`.engine.json`), preservando tags, durações, pivô de slice e eventos declarados.
- `batch_export_sprites`: processa até 256 arquivos `.ase`/`.aseprite` sob um diretório autorizado, exporta PNG ou spritesheet em escalas inteiras (por exemplo, 1x/2x/4x), aplica no-clobber e restaura o documento original salvo.
- APNG é rejeitado antes de qualquer comando ao bridge; nenhum PNG estático é apresentado falsamente como APNG. A decisão é intencional: a [documentação oficial de exportação](https://www.aseprite.org/docs/exporting/), a [CLI oficial](https://www.aseprite.org/docs/cli/) e o [registro atual de formatos do Aseprite](https://github.com/aseprite/aseprite/blob/main/src/app/file/file_formats_manager.cpp) não expõem um encoder APNG. Adicionar um encoder Node de terceiros ampliaria a superfície de dependências e manutenção sem suporte nativo verificável; a interface mantém `apng` apenas para retornar uma incompatibilidade explícita e estável.

Ferramentas destrutivas exigem `confirm: true`; gravações em caminho existente exigem `overwrite: true`. Mutações com `returnPreview: true` retornam a imagem como conteúdo MCP sem repetir o base64 no bloco textual.

---

## Testes e integração contínua

- Testes unitários, de contrato, integração e E2E executados pelo Vitest; a configuração falha se uma seleção de testes não encontrar casos.
- O mock cobre o protocolo, recuperação incremental e as estruturas expostas pelas ferramentas.
- `test/real/aseprite-api-smoke.lua` valida contratos críticos dentro de um processo Aseprite real, incluindo as APIs usadas por cópia/movimentação de cels, reordenação e duração de frames, atualização/exclusão de tags e Undo/Redo atômico.
- O workflow de CI executa Node.js 18/20/22 e os sistemas Linux, Windows e macOS; um job separado compila a versão do Aseprite fixada no workflow e roda o smoke test real.
- O smoke local real depende de um executável Aseprite disponível; os testes headless do Node não substituem essa validação da API Lua.

---

## Solução de problemas

### O bridge permanece desconectado no Aseprite
1. Confirme que a extensão está instalada e que o diálogo exibiu `Connected`. Ela inicia o daemon local automaticamente ao abrir o Aseprite.
2. Verifique se a porta coincide (`ASEPRITE_PORT`, padrão `32123`).
3. Se você configurou `ASEPRITE_BRIDGE_TOKEN` no servidor MCP, confirme que a mesma variável foi definida no ambiente do Aseprite e que o Aseprite foi reiniciado.
4. Tentativas com token divergente são rejeitadas com o código `1008 (Invalid bridge authentication)`.

### Erro de acesso negado em operações de arquivo
- Se receber `Access denied: path is outside allowed roots`, adicione o diretório do arquivo à variável `ASEPRITE_ALLOWED_PATHS`.
- Certifique-se de que os caminhos em `ASEPRITE_ALLOWED_PATHS` sejam absolutos e usem `;` como separador no Windows.
- Para usar caminhos relativos, defina `ASEPRITE_PROJECT_ROOT` dentro de uma das raízes autorizadas.

### Arquivo já existe e não é salvo
- Por padrão, o servidor adota a política no-clobber. Ao salvar em um arquivo existente via `save_sprite_as` ou exportar via `export_png`, inclua `"overwrite": true` nos argumentos da ferramenta.

---

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.
