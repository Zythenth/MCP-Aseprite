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
- **Ferramentas completas**: formas geométricas, preenchimento por inundação, substituição de cores, paletas, camadas, frames e tags.
- **Segurança de arquivos**: contenção estrita de caminhos (`ASEPRITE_ALLOWED_PATHS`), política no-clobber por padrão (`overwrite: true` explícito) e validação de arquivo esperado no salvamento.
- **Autenticação opcional por token**: proteção contra conexões locais não autorizadas no bridge WebSocket (`ASEPRITE_BRIDGE_TOKEN`).
- **Mock Bridge em memória**: possibilita testes de integração rápidos e headless sem necessidade de abrir a interface do Aseprite.
- **Transporte padrão stdio**: mensagens de protocolo MCP isoladas em `stdout` e registros de diagnóstico em `stderr`.

---

## Arquitetura

```text
Cliente MCP (Gemini / Claude / outros)
    |
    | MCP sobre stdio
    v
Aseprite MCP Server (Node.js/TypeScript)
    |
    | WebSocket JSON-RPC em 127.0.0.1:32123 (com auth opcional)
    v
Bridge Lua (aseprite-bridge.lua)
    |
    v
Documento ativo no Aseprite
```

O servidor registra as ferramentas MCP, valida parâmetros de entrada e encaminha comandos em envelopes correlacionados por ID ao bridge Lua. O script executa comandos na API oficial do Aseprite e retorna resultados estruturados.

---

## Requisitos

- **Node.js**: versão 18.0.0 ou superior.
- **npm**: gerenciador de pacotes incluso no Node.js.
- **Aseprite**: versão v1.2.30+ ou v1.3+ com suporte à API WebSocket em Lua.
- **PowerShell**: para execução dos scripts de conveniência no Windows.

---

## Instalação rápida

Clone o repositório e navegue até a pasta:

```bash
git clone https://github.com/Zythenth/MCP-Aseprite.git
cd MCP-Aseprite
```

### Windows (Automático)

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
5. Copia `lua/aseprite-bridge.lua` para `%APPDATA%\Aseprite\scripts` caso o Aseprite seja detectado (ou se `-InstallLuaToAseprite` for fornecido).

### Instalação manual (Todas as plataformas)

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

O ponto de entrada compilado será gerado em `dist/index.js`.

---

## Instalação do Bridge no Aseprite

Caso o script não tenha sido copiado automaticamente pelo instalador:

1. Abra o Aseprite;
2. Acesse o menu **File > Scripts > Open Scripts Folder**;
3. Copie o arquivo `lua/aseprite-bridge.lua` para dentro da pasta aberta;
4. No Aseprite, clique em **File > Scripts > Rescan Scripts Folder**;
5. Execute **File > Scripts > aseprite-bridge**.

O diálogo do bridge exibirá o estado da conexão (`Connecting...`, `Connected` ou `Disconnected (Reconnecting...)`). Ele tenta se conectar ao servidor em `127.0.0.1:PORT` e reconecta automaticamente.

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
        "ASEPRITE_ALLOWED_PATHS": "C:/Projetos/PixelArt"
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
        "ASEPRITE_BRIDGE_TOKEN": "SubstituaPeloSeuTokenAleatorio12345"
      }
    }
  }
}
```

---

## Execução Manual e Scripts

Para executar o servidor manualmente:

```bash
npm start
```

No Windows via PowerShell:

```powershell
# Execução padrão
.\start.ps1

# Especificando porta e diretórios autorizados
.\start.ps1 -Port 32123 -AllowedPaths @("C:\Projetos\PixelArt")

# Execução com Mock Bridge (headless, sem Aseprite)
.\start.ps1 -Mock
```

> [!TIP]
> **Segurança de Segredos no Terminal:** Evite passar `-BridgeToken` como argumento de linha de comando para não gravar segredos no histórico do shell (`Get-History`, `.bash_history`) ou na listagem de processos do sistema. Prefira sempre definir a variável de ambiente `$env:ASEPRITE_BRIDGE_TOKEN` na sessão do terminal ou nas variáveis de ambiente de usuário antes de executar o script.

---

## Resumo das Ferramentas MCP

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

### Camadas, Animação e Arquivos
- Camadas: `list_layers`, `create_layer`, `rename_layer`, `delete_layer`, `select_layer`, `set_layer_visibility`, `set_layer_opacity`, `move_layer`, `create_group`.
- Frames e Tags: `list_frames`, `select_frame`, `create_frame`, `duplicate_frame`, `delete_frame`, `set_frame_duration`, `create_tag`, `list_tags`.
- Arquivos: `new_sprite`, `open_sprite`, `save_sprite` (salva o arquivo ativo sem parâmetros do usuário, validado internamente via `aseprite_status`), `save_sprite_as` (com `overwrite`), `export_png` (com `overwrite`), `resize_canvas`.

---

## Solução de problemas

### O bridge permanece desconectado no Aseprite
1. Confirme que o servidor MCP está em execução.
2. Verifique se a porta coincide (`ASEPRITE_PORT`, padrão `32123`).
3. Se você configurou `ASEPRITE_BRIDGE_TOKEN` no servidor MCP, confirme que a mesma variável foi definida no ambiente do Aseprite e que o Aseprite foi reiniciado.
4. Tentativas com token divergente são rejeitadas com o código `1008 (Invalid bridge authentication)`.

### Erro de acesso negado em operações de arquivo
- Se receber `Access denied: path is outside allowed roots`, adicione o diretório do arquivo à variável `ASEPRITE_ALLOWED_PATHS`.
- Certifique-se de que os caminhos em `ASEPRITE_ALLOWED_PATHS` sejam absolutos e usem `;` como separador no Windows.

### Arquivo já existe e não é salvo
- Por padrão, o servidor adota a política no-clobber. Ao salvar em um arquivo existente via `save_sprite_as` ou exportar via `export_png`, inclua `"overwrite": true` nos argumentos da ferramenta.

---

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.
