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
- Nunca descubra parâmetros fazendo chamadas de teste a ferramentas mutáveis com chaves inventadas ou valores como `invalidKey`. Consulte o schema exposto; se ainda houver dúvida, pare antes de modificar o sprite.

## Desenho pixel a pixel

- Converta o desenho diretamente em coordenadas explícitas `{x, y, color}`.
- Use `set_pixels` ou operações `set_pixels` dentro de `batch_animation_edits`.
- Uma lista em lote continua definindo cada pixel individualmente, mas não deve conter a arte completa de um frame novo em uma única operação.
- Use formas automáticas somente quando o pedido permitir; não substitua uma matriz ou desenho pixel a pixel por elipses ou retângulos.
- Construa cada frame novo em no mínimo três passes separados: silhueta/contorno, massas de cor/sombra e detalhes/luz. Use operações adicionais quando a complexidade exigir.
- Após cada passe, obtenha e examine o PNG atualizado com `get_canvas` ou `get_pixel_grid_preview`; não envie o passe seguinte na mesma chamada ou antes dessa inspeção.
- Faça uma pose por vez: planeje as coordenadas, aplique pixels explícitos em um passe limitado, inspecione visualmente e só então avance. Não pinte todos os frames em um único `batch_animation_edits`.

## Referências

- Quando o usuário informar apenas o nome de uma imagem, procure-a recursivamente no projeto com `find_reference_images`.
- Se houver um resultado, carregue-o com `load_reference_image`; se houver vários, peça ao usuário que escolha; se não houver nenhum, informe isso.
- Analise visualmente a imagem retornada e registre a análise vinculada ao hash quando houver workflow de animação.
- Preserve o design, as proporções, a paleta, os materiais, a iluminação e o contorno relevantes da referência.

## Animação e conclusão

- Planeje poses-chave, intermediários, timing, spacing, frames, durações e tags antes de finalizar.
- Traduza verbos de movimento em critérios visuais verificáveis antes de pintar. Em salto ou pulo, inclua decolagem, pelo menos uma pose inteiramente no ar com espaço transparente sob os pés/corpo e aterrissagem; não confunda alongamento preso ao chão com pose aérea. Em idle, só mantenha contato constante quando esse for realmente o movimento solicitado.
- Use `batch_animation_edits` para mudanças lógicas que devam formar um único Undo.
- Renderize um preview, execute a análise temporal e faça a autorrevisão antes de salvar.
- Na revisão final, obtenha um PNG de cada frame com `get_canvas` e uma visão temporal em PNG (filmstrip/spritesheet) com a ferramenta de preview apropriada. Quando o usuário pedir exportação, gere também o spritesheet PNG com `export_sprite_sheet` e confirme o caminho gravado.
- Trate a escala e as dimensões retornadas por previews como propriedades da mídia de revisão. Elas nunca justificam `resize_canvas`; preserve as dimensões solicitadas do sprite original.
- Se o sprite ativo mudar após um preview, pare as edições e recupere ou reabra o projeto original. Nunca redimensione, desfaça ou “conserte” um documento temporário de preview.
- No Gemini/Antigravity, o agente principal deve chamar um subagente independente de revisão pela função nativa de subagentes/tarefas antes de concluir. Não substitua essa etapa por autorrevisão do mesmo agente. Se o recurso não estiver disponível, informe que a revisão independente não foi concluída.
- Entregue ao subagente os PNGs atuais de todos os frames e o filmstrip/spritesheet PNG. O revisor deve analisar tanto a animação (intenção do movimento, poses, timing, spacing, arco, contato/decolagem/aterrissagem, jitter, flicker e loop) quanto a pixel art (silhueta, volume, clusters, paleta, iluminação, pixels órfãos, banding e pillow shading). O MCP fornece ferramentas e evidências; ele não inicia outro cliente nem executa `agy` por conta própria.
- Depois de qualquer correção visual, gere um novo preview e repita as revisões exigidas.
- Salve o projeto `.aseprite` somente ao final, salvo quando o usuário solicitar checkpoint ou recuperação.
- Não sobrescreva arquivos sem confirmação explícita.
- Verifique o projeto salvo e as exportações antes de declarar sucesso.

## Evidência mínima

Não afirme que desenhou ou concluiu uma animação sem receber sucesso das operações de edição, inspecionar os frames pelo MCP e renderizar um preview atual.
