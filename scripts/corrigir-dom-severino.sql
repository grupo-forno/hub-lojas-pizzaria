-- Corrige os botões de pedido da Dom Severino que apontam para a unidade Hugo (/fornopaulistaleste/pedidos).
-- NÃO roda sozinho: execute no banco publicado, depois de conferir o resultado do SELECT (passo 1).
-- O que muda é só a coluna `url` (e `loja`, para os contadores por unidade); ids, ordem e histórico de cliques ficam intactos.

-- 1) Quais registros são suspeitos (botão cujo título, bloco ou código fala de Dom Severino mas o endereço é do Hugo):
select a.id, b.nome as bloco, a.titulo, a.loja, a.url
from links a left join links b on b.id = a.pai
where a.tipo = 'acao' and a.url like '%/fornopaulistaleste/pedidos%'
  and (a.titulo ilike '%severino%' or b.nome ilike '%severino%' or b.titulo ilike '%severino%' or a.loja = 'fornopaulistadomseverino');
-- Esperado: "Faça Seu Pedido" (bloco Dom Severino) e "Peça na Dom Severino" (bloco BLACK FORNO). Se aparecer outra linha, revise antes do passo 2.

-- 2) Corrige (substitui só o trecho da unidade; query string e demais parâmetros do endereço continuam):
update links a set url = replace(a.url, '/fornopaulistaleste/pedidos', '/fornopaulistadomseverino/pedidos'),
                   loja = 'fornopaulistadomseverino'
from (select a2.id from links a2 left join links b on b.id = a2.pai
      where a2.tipo = 'acao' and a2.url like '%/fornopaulistaleste/pedidos%'
        and (a2.titulo ilike '%severino%' or b.nome ilike '%severino%' or b.titulo ilike '%severino%' or a2.loja = 'fornopaulistadomseverino')) x
where a.id = x.id;

-- 3) Conferência: nenhum botão de Dom Severino deve restar apontando para o leste.
select id, titulo, url from links where tipo = 'acao' and url like '%/fornopaulista%/pedidos%' order by id;
