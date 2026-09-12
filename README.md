# Aseprite MCP Server

Servidor Model Context Protocol (MCP) em TypeScript que conecta clientes compatíveis, como o Google Gemini, a um documento aberto no Aseprite.

O projeto permite inspecionar sprites, ler pixels, editar imagens, controlar camadas e frames e validar cada alteração por meio de previews PNG. A comunicação com o Aseprite ocorre por um bridge Lua local, sem automação de mouse e sem salvar arquivos automaticamente.

Fluxo principal:

```text
Observar -> analisar -> editar -> inspecionar novamente -> corrigir
```

## Recursos principais

- Inspeção visual com PNG, escala nearest-neighbor, grade e réguas de coordenadas.
- Leitura exata de pixels em formatos hexadecimal, RGBA, indexado e compacto.
- Pintura em lote com uma única etapa de Undo por operação.
- Ferramentas para formas, paletas, camadas, frames, tags e arquivos.
- Controle de revisão para acompanhar alterações no sprite.
- Mock Bridge em memória para testes sem abrir o Aseprite.
- Transporte MCP por `stdio`, com logs isolados em `stderr`.
- WebSocket restrito ao loopback local `127.0.0.1:32123`.

## Arquitetura

```text
Cliente MCP
    |
    | MCP por stdio
    v
Aseprite MCP Server (Node.js/TypeScript)
    |
    | WebSocket JSON-RPC em 127.0.0.1:32123
    v
Bridge Lua
    |
    v
Documento aberto no Aseprite
```

O servidor registra as ferramentas MCP, processa imagens e encaminha comandos ao bridge. O bridge executa as operações no documento ativo usando a API Lua do Aseprite e agrupa edições em transações atômicas.

## Requisitos

- Node.js 18 ou superior.
- npm.
- Aseprite com suporte a WebSocket na API Lua.
- PowerShell para usar os scripts auxiliares no Windows.

Os comandos npm funcionam em Windows, macOS e Linux. A instalação automática do bridge fornecida neste repositório é específica para Windows.

## Instalação rápida

Clone o repositório e entre na pasta do projeto:

```bash
git clone https://github.com/Zythenth/MCP-Aseprite.git
cd MCP-Aseprite
```

### Windows

No PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

O script:

1. verifica Node.js e npm;
2. instala as dependências;
3. compila o TypeScript;
4. executa os testes, exceto quando usado com `-SkipTests`;
5. copia `lua/aseprite-bridge.lua` para a pasta de scripts quando encontra uma instalação do Aseprite no perfil do usuário.

### Instalação manual

```bash
npm install
npm run build
npm test
```

O arquivo de entrada compilado será criado em `dist/index.js`.

## Instalação do bridge no Aseprite

Se o instalador não copiar o bridge automaticamente:

1. abra o Aseprite;
2. acesse **File > Scripts > Open Scripts Folder**;
3. copie `lua/aseprite-bridge.lua` para a pasta aberta;
4. acesse **File > Scripts > Rescan Scripts Folder**;
5. execute **File > Scripts > aseprite-bridge**.

O diálogo do bridge mostra o estado da conexão. Ele tenta se conectar ao servidor em `127.0.0.1:32123` e reconecta automaticamente quando o servidor fica disponível.

## Configuração do cliente MCP

Compile o projeto antes de configurar o cliente. Depois, use o caminho absoluto de `dist/index.js`:

```json
{
  "mcpServers": {
    "aseprite": {
      "command": "node",
      "args": [
        "C:/caminho/absoluto/MCP-Aseprite/dist/index.js"
      ]
    }
  }
}
```

No Windows, barras normais funcionam dentro do JSON. Também é possível escapar barras invertidas, por exemplo `C:\\caminho\\MCP-Aseprite\\dist\\index.js`.

O bridge e o servidor usam a porta `32123` por padrão. Se o servidor for configurado com outra porta por `ASEPRITE_PORT` ou `ASEPRITE_WS_PORT`, o valor de `PORT` no início de `lua/aseprite-bridge.lua` também precisa ser alterado.

## Execução

Quando iniciado pelo cliente MCP, o processo Node.js é aberto automaticamente. Para executá-lo manualmente:

```bash
npm start
```

No Windows:

```powershell
.\start.ps1
```

Para iniciar o servidor junto com o Mock Bridge:

```powershell
.\start.ps1 -Mock
```

O modo mock é útil para testar a integração sem uma instância do Aseprite.

## Ferramentas MCP

### Inspeção

| Ferramenta | Função |
|---|---|
| `aseprite_status` | Informa conexão, documento ativo, dimensões, camada, frame e revisão. |
| `get_sprite_info` | Retorna a estrutura de camadas, frames, opacidades e modos de mesclagem. |
| `inspect_sprite` | Retorna preview PNG e dados estruturados dos pixels na mesma chamada. |
| `get_canvas` | Renderiza o frame ou uma camada como PNG com escala nearest-neighbor. |
| `get_pixel_grid` | Lê pixels em coordenadas absolutas do canvas. |
| `get_pixel_grid_preview` | Gera uma visualização ampliada com grade, réguas e destaques. |

### Edição

| Ferramenta | Função |
|---|---|
| `set_pixels` | Pinta pixels em lote dentro de uma única transação de Undo. |
| `set_pixel` | Pinta um pixel usando uma cor `#RRGGBBAA`. |
| `erase_pixels` | Torna uma lista de coordenadas transparente. |
| `undo` | Desfaz a última edição atômica. |
| `redo` | Refaz a última edição desfeita. |

### Formas e cores

- Formas: `draw_line`, `draw_rectangle`, `draw_ellipse`.
- Preenchimento: `flood_fill`, `replace_color`.
- Histórico visual: `get_changes_since`.
- Paleta: `get_palette`, `set_palette_color`, `find_palette_color`.

### Camadas, animação e arquivos

- Camadas: `list_layers`, `create_layer`, `rename_layer`, `delete_layer`, `select_layer`, `set_layer_visibility`, `set_layer_opacity`, `move_layer`, `create_group`.
- Frames e tags: `list_frames`, `select_frame`, `create_frame`, `duplicate_frame`, `delete_frame`, `set_frame_duration`, `create_tag`, `list_tags`.
- Arquivos e canvas: `new_sprite`, `open_sprite`, `save_sprite`, `save_sprite_as`, `export_png`, `resize_canvas`.

As operações destrutivas de exclusão exigem `confirm: true`. O servidor nunca salva o documento automaticamente.

## Exemplo de fluxo

```text
1. aseprite_status()
2. inspect_sprite({ scale: 4, format: "compact" })
3. set_pixels({
     pixels: [
       { x: 14, y: 8, color: "#0088FFFF" }
     ],
     returnPreview: true
   })
4. inspect_sprite({ scale: 4, format: "compact" })
5. save_sprite()
```

Use `save_sprite` ou `save_sprite_as` somente depois de validar o resultado. Até essa chamada, as alterações permanecem no documento aberto sem sobrescrever o arquivo em disco.

## Comandos de desenvolvimento

| Comando | Descrição |
|---|---|
| `npm run build` | Compila o TypeScript em `dist/`. |
| `npm start` | Executa o servidor compilado. |
| `npm run dev` | Mantém o compilador TypeScript em modo watch. |
| `npm test` | Executa toda a suíte com Vitest. |
| `npm run test:unit` | Executa os testes unitários. |
| `npm run test:integration` | Executa os testes de integração. |
| `npm run test:e2e` | Executa os testes de ponta a ponta. |
| `npm run test:watch` | Executa o Vitest em modo interativo. |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos. |

## Segurança e comportamento

- O WebSocket aceita apenas endereços de loopback.
- O canal `stdout` é reservado ao protocolo MCP; logs são enviados para `stderr`.
- O bridge modifica somente o documento ativo no Aseprite.
- O salvamento em disco depende de uma chamada explícita.
- Edições em lote são agrupadas para permitir Undo atômico.
- Entradas, coordenadas, limites e cores são validados antes da execução.

## Solução de problemas

### O bridge permanece desconectado

- Confirme que o processo MCP está em execução.
- Confirme que o bridge foi carregado em **File > Scripts**.
- Verifique se a porta `32123` está livre.
- Mantenha o mesmo número de porta no servidor e no bridge Lua.

### O cliente não encontra `dist/index.js`

Execute:

```bash
npm install
npm run build
```

Depois confirme que a configuração do cliente usa um caminho absoluto.

### Os testes falham por conflito de porta

Feche processos antigos do servidor e execute `npm test` novamente. Os testes automatizados usam o Mock Bridge e não exigem o Aseprite aberto.

## Referências

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Documentação de scripts do Aseprite](https://www.aseprite.org/docs/scripting/)
- [API do Aseprite](https://www.aseprite.org/api/)
- [Pixel Joint: The Pixel Art Tutorial](https://pixeljoint.com/forum/forum_posts.asp?TID=11299)
