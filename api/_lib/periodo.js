// Dias do painel: sempre inteiros e no horário de São Paulo.
const FUSO = 'America/Sao_Paulo';
// Início do dia (no fuso do painel) de k dias atrás: período de N dias = hoje + N-1 dias anteriores.
const inicio = k => `((date_trunc('day', now() at time zone '${FUSO}') - interval '${Number(k)} days') at time zone '${FUSO}')`;
module.exports = { FUSO, inicio };
