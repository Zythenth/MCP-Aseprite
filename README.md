# Aseprite MCP Server 🎨

Servidor MCP oficial em **TypeScript / Node.js** que conecta o **Google Gemini** diretamente ao **Aseprite**, permitindo criar e editar pixel art iterativamente através de um ciclo visual completo de observação e pintura:

$$\text{Observar} \longrightarrow \text{Analisar} \longrightarrow \text{Pintar} \longrightarrow \text{Observar Novamente} \longrightarrow \text{Corrigir}$$

---

## 🏛️ Arquitetura do Sistema

```
+-------------------------------------------------------------+
|                       Google Gemini                         |
+-------------------------------------------------------------+
                              │
                    MCP Protocol (stdio)
          JSON-RPC 2.0 em stdout (logs estritos em stderr)
                              ▼
+-------------------------------------------------------------+
|             Aseprite MCP Server (TypeScript/Node)           |
|  - MCP Tools & Resources (@modelcontextprotocol/sdk)        |
|  - Motor de Imagem Puro (Nearest-Neighbor, Grid & Rulers)   |
|  - Servidor WebSocket Local (127.0.0.1:32123)              |
+-------------------------------------------------------------+
                              ▲
                       WebSocket Local
                         (JSON-RPC)
                              ▼
+-------------------------------------------------------------+
|             Bridge Lua (lua/aseprite-bridge.lua)            |
|  - Event-driven WebSocket nativo do Aseprite (sem travar)   |
|  - Mini diálogo de status (Connected / Disconnected)        |
|  - Transações Atômicas de Undo (app.transaction)            |
|  - Normalização Cel.bounds -> Canvas Coordenadas Absolutas |
+-------------------------------------------------------------+
                              ▼
+-------------------------------------------------------------+
|                   Documento Aberto no Aseprite              |
|              (Sprite Real / Camadas / Frames / Cels)        |
+-------------------------------------------------------------+
```

---

## 🚀 Requisitos

* **Sistema Operacional:** Windows 10/11 (ou macOS / Linux)
* **Node.js:** Versão 18.0.0 ou superior (`node -v`)
* **Aseprite:** Versão 1.2.30+ ou 1.3+ instalada
* **PowerShell:** Para execução dos scripts no Windows

---

## 📦 Instalação

### Opção 1: Instalação Automática no Windows (Recomendada)

Abra o PowerShell na pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

O script:
1. Valida o ambiente Node.js e npm.
2. Instala as dependências (`npm install`).
3. Compila o TypeScript (`npm run build`).
4. Roda a suíte completa de testes (`npm test`).
5. **Copia automaticamente** o script `lua/aseprite-bridge.lua` para a pasta de scripts do Aseprite (`%APPDATA%\Aseprite\scripts\aseprite-bridge.lua`).

### Opção 2: Instalação Manual

```bash
# 1. Instalar dependências
npm install

# 2. Compilar TypeScript
npm run build

# 3. Executar os testes automatizados
npm test
```

---

## 🔌 Como Iniciar o Bridge no Aseprite

1. Abra o **Aseprite**.
2. Vá no menu: **File → Scripts → Open Scripts Folder**.
3. Verifique se o arquivo `aseprite-bridge.lua` está na pasta (o script `install.ps1` já copia automaticamente; caso contrário, copie o arquivo da pasta `lua/aseprite-bridge.lua` para lá).
4. No Aseprite, clique em: **File → Scripts → Rescan Scripts Folder**.
5. Clique em: **File → Scripts → aseprite-bridge**.
6. Uma pequena janela flutuante não intrusiva aparecerá mostrando:
   * **Status:** `Connecting to 127.0.0.1:32123...` (ou `Connected (32123)` assim que o servidor MCP for iniciado).

---

## ⚙️ Configuração no Gemini / Antigravity

Adicione o servidor no seu arquivo de configuração do Gemini (`gemini_mcp.json` ou `mcpServers`):

```json
{
  "mcpServers": {
    "aseprite": {
      "command": "node",
      "args": [
        "C:/Users/<seu-usuario>/OneDrive/Documentos/mcp/dist/index.js"
      ],
      "env": {
        "ASEPRITE_MCP_PORT": "32123"
      }
    }
  }
}
```

Ou via CLI do Antigravity:

```bash
agy mcp add aseprite -- node C:/Users/<seu-usuario>/OneDrive/Documentos/mcp/dist/index.js
```

---

## 🧪 Testes Automatizados (Sem Aseprite Aberto)

O projeto inclui um **Mock Engine** em memória que emula completamente o Aseprite (camadas, cels, blending, transações de Undo e geração de PNG).

Para rodar todos os testes automatizados:

```bash
npm test
```

Para iniciar o servidor MCP já acoplado ao Mock Bridge em segundo plano (ótimo para testar o Gemini mesmo sem o Aseprite aberto):

```powershell
.\start.ps1 -Mock
```

---

## 🛠️ Catálogo Completo de Ferramentas MCP

### 👁️ Ferramentas Primárias de Visão e Inspeção

| Ferramenta | Descrição |
|---|---|
| `inspect_sprite` | **Principal ferramenta de visão do Gemini.** Retorna na mesma chamada a imagem PNG (escala nearest-neighbor), dimensões, frame/layer atuais, revision e os pixels estruturados. |
| `get_canvas` | Renderiza o frame como PNG nítido via conteúdo de imagem nativo do MCP (`image/png`). Suporta escala (`scale: 8`, etc.) e tabuleiro quadriculado opcional (`checkerboard`). |
| `get_pixel_grid` | Retorna a matriz exata de pixels em coordenadas absolutas do canvas `(0,0)` no topo esquerdo. Formatos: `hex` (`#RRGGBBAA`), `rgba`, `indexed` ou `compact` (minipaleta de índices para economia crítica de tokens). |
| `get_pixel_grid_preview` | Preview visual ampliado com **linhas de grade (grid)**, **réguas de coordenadas X/Y com fonte bitmap** e destaque de regiões ou pixels. |
| `aseprite_status` | Verifica se o Aseprite está conectado, arquivo aberto, dimensões, quantidade de layers e frames, e número de revisão. |
| `get_sprite_info` | Retorna a árvore hierárquica completa de camadas, opacidades, blend modes e durações dos frames. |

### 🖌️ Ferramentas de Pintura e Edição Transacional

| Ferramenta | Descrição |
|---|---|
| `set_pixels` | **Principal ferramenta de pintura.** Altera centenas a milhares de pixels em uma única chamada. Todas as alterações são agrupadas em **uma única transação de Undo** no Aseprite. Retorna bounds modificados e opcionalmente `returnPreview: true`. |
| `set_pixel` | Pinta um pixel individual com cor `#RRGGBBAA`. |
| `erase_pixels` | Apaga uma lista de coordenadas tornando-as transparentes (`#00000000`). |
| `undo` | Desfaz a última ação atômica de edição no Aseprite. |
| `redo` | Refaz a última ação desfeita. |

### 📐 Formas Geométricas & Preenchimento

| Ferramenta | Descrição |
|---|---|
| `draw_line` | Desenha linhas usando o algoritmo de Bresenham para pixel art (com espessura customizável). |
| `draw_rectangle` | Desenha retângulos (contorno ou preenchido). |
| `draw_ellipse` | Desenha elipses e círculos (contorno ou preenchido). |
| `flood_fill` | Balde de tinta (preenchimento por contiguidade) com tolerância de cor opcional. |
| `replace_color` | Substitui uma cor por outra em toda a camada ou sprite. |
| `get_changes_since` | Retorna a diferença de pixels e bounding box alterados desde uma `revision` anterior. |

### 🎨 Paleta de Cores

| Ferramenta | Descrição |
|---|---|
| `get_palette` | Lista todas as cores da paleta com índice, RGBA e HEX. |
| `set_palette_color` | Altera a cor de um índice específico da paleta. |
| `find_palette_color` | Encontra a cor exata ou a mais próxima via distância euclidiana. |

### 📑 Camadas (Layers) & Animação (Frames)

* **Camadas:** `list_layers`, `create_layer`, `rename_layer`, `delete_layer` (com `confirm: true`), `select_layer`, `set_layer_visibility`, `set_layer_opacity`, `move_layer`, `create_group`.
* **Frames:** `list_frames`, `select_frame`, `create_frame`, `duplicate_frame`, `delete_frame`, `set_frame_duration`, `create_tag`, `list_tags`.
* **Documento/Canvas:** `new_sprite`, `open_sprite`, `save_sprite`, `save_sprite_as`, `export_png`, `resize_canvas`.

---

## 💡 Fluxo de Trabalho do Gemini na Prática

Ao conectar, o servidor envia automaticamente ao modelo um protocolo abrangente de pixel art que exige uma breve pré-produção antes de qualquer edição. Ele cobre inspeção e referências, especificação técnica do ativo, paleta e modos de cor, construção por clusters, contornos, luz e materiais, textura, anti-aliasing e dithering, animação, tiles/tilesets, iteração segura e validação de exportação. Também inclui um catálogo de falhas comuns, como pillow shading, banding, jaggies, doubles, ruído de pixels soltos, sel-out automático, palette drift, repetição visível de tiles, origem instável entre frames e interpolação que borra pixels. As escolhas explícitas do usuário, a referência, as limitações de hardware e os requisitos da engine sempre têm prioridade.

O protocolo foi consolidado a partir da documentação oficial do Aseprite e do tutorial técnico da comunidade Pixel Joint:

* [Pixel Joint — The Pixel Art Tutorial](https://pixeljoint.com/forum/forum_posts.asp?TID=11299): controle deliberado, clusters, linhas, AA, dithering, banding, pillow shading, ruído, sel-out e construção de paleta.
* [Aseprite — Color Mode](https://aseprite.com/docs/color-mode/) e [Color Profile](https://aseprite.com/docs/color-profile/): RGB/indexado, alpha, índice transparente e gerenciamento de perfil.
* [Aseprite — Animation](https://aseprite.com/docs/animation/) e [Onion Skinning](https://aseprite.com/docs/onion-skinning/): frames, durações, tags, preview e comparação entre poses.
* [Aseprite — Tiled Mode](https://aseprite.com/docs/tiled-mode/): validação de padrões repetidos.
* [Aseprite — Sprite Sheets](https://aseprite.com/docs/sprite-sheet/) e [CLI](https://aseprite.com/docs/cli/): seleção por layers/tags, padding, trim, metadata e extrusão de bordas.

### Exemplo 1: Analisar e Editar um Personagem
1. **Gemini:** `inspect_sprite({ scale: 4, format: "compact" })`
   *Recebe o PNG nítido e a matriz de pixels compacta.*
2. **Gemini analisa visualmente:** "O olho direito em (14, 8) precisa ser azul."
3. **Gemini:** `set_pixels({ pixels: [{ x: 14, y: 8, color: "#0088FFFF" }], returnPreview: true })`
   *Recebe a confirmação e o novo preview atualizado imediatamente.*
4. **Gemini verifica:** Confirma se o resultado visual ficou harmônico com o restante do sprite.

### Exemplo 2: Criação do Zero
1. `new_sprite({ width: 32, height: 32, colorMode: "rgb" })`
2. `create_layer({ name: "Outline" })`
3. `draw_rectangle({ x: 8, y: 8, width: 16, height: 16, color: "#111111FF", filled: true })`
4. `inspect_sprite()`
5. `save_sprite_as({ filePath: "C:/pixelart/personagem.aseprite" })`

---

## 🛡️ Isolamento e Segurança

* **Comunicação Segura:** O servidor WebSocket escuta **estritamente em `127.0.0.1`** (loopback local), rejeitando conexões externas.
* **Pureza do Protocolo Stdio:** 100% dos logs e mensagens de diagnóstico são enviados exclusivamente para `stderr`. O canal `stdout` é reservado sem interferências para o protocolo JSON-RPC.
* **Proteção contra Sobrescrita Acidental:** Documentos abertos nunca são salvos em disco automaticamente; o salvamento só ocorre se o modelo chamar explicitamente `save_sprite` ou `save_sprite_as`.
* **Resiliência do Aseprite:** O script Lua utiliza o loop de eventos/timers assíncrono do Aseprite, impedindo travamento da interface do usuário.
