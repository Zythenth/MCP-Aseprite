---
name: aseprite
description: Cria, edita, anima, revisa, salva e exporta pixel art no Aseprite usando exclusivamente as ferramentas do servidor MCP aseprite. Use quando o usuário pedir sprites, animações, referências visuais, paletas ou operações no Aseprite.
---

# Aseprite via MCP

Use exclusivamente ferramentas cujo nome começa com `aseprite/` para observar ou modificar o Aseprite.

## Limite de ferramentas

- Não execute Python, PowerShell, CMD, Bash, Node, terminal ou shell.
- Não crie scripts ou arquivos auxiliares para gerar pixels.
- Não substitua uma operação MCP por edição direta no sistema de arquivos.
- Se uma etapa não puder ser realizada pelo MCP, pare e explique a limitação em vez de contorná-la.
- Antes de agir, confirme `aseprite_status`. Não continue enquanto `connected` não for `true`.

## Desenho pixel a pixel

- Converta o desenho diretamente em coordenadas explícitas `{x, y, color}`.
- Use `set_pixels` ou operações `set_pixels` dentro de `batch_animation_edits`.
- Uma lista em lote continua definindo cada pixel individualmente e deve ser preferida a centenas de chamadas `set_pixel`.
- Use formas automáticas somente quando o pedido permitir; não substitua uma matriz ou desenho pixel a pixel por elipses ou retângulos.
- Após cada passe importante, inspecione o resultado por uma ferramenta visual do MCP.

## Referências

- Quando o usuário informar apenas o nome de uma imagem, procure-a recursivamente no projeto com `find_reference_images`.
- Se houver um resultado, carregue-o com `load_reference_image`; se houver vários, peça ao usuário que escolha; se não houver nenhum, informe isso.
- Analise visualmente a imagem retornada e registre a análise vinculada ao hash quando houver workflow de animação.
- Preserve o design, as proporções, a paleta, os materiais, a iluminação e o contorno relevantes da referência.

## Animação e conclusão

- Planeje poses-chave, intermediários, timing, spacing, frames, durações e tags antes de finalizar.
- Use `batch_animation_edits` para mudanças lógicas que devam formar um único Undo.
- Renderize um preview, execute a análise temporal e faça a autorrevisão antes de salvar.
- Quando o ambiente oferecer subagentes e houver workflow estrito, delegue o QA visual a um revisor independente e registre somente o resultado realmente produzido.
- Depois de qualquer correção visual, gere um novo preview e repita as revisões exigidas.
- Salve o projeto `.aseprite` somente ao final, salvo quando o usuário solicitar checkpoint ou recuperação.
- Não sobrescreva arquivos sem confirmação explícita.
- Verifique o projeto salvo e as exportações antes de declarar sucesso.

## Evidência mínima

Não afirme que desenhou ou concluiu uma animação sem receber sucesso das operações de edição, inspecionar os frames pelo MCP e renderizar um preview atual.
