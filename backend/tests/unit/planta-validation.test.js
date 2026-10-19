const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const schemas = require('../../src/validators/plantaValidators');

test('planta rejeita atribuição de dono, confiança, status e fase inválida', () => {
  const base = { nome: 'Minha planta', faseAtual: 'SEMENTE' };
  for (const fields of [{ usuarioId: randomUUID() }, { statusIdentificacao: 'IDENTIFICADA' },
    { confiancaIdentificacao: 1 }, { faseAtual: 'INVENTADA' }, { dataPlantio: '2026-02-30' }]) {
    assert.equal(schemas.plantaCreateSchema.safeParse({ ...base, ...fields }).success, false);
  }
  assert.equal(schemas.plantaCreateSchema.safeParse(base).success, true);
});

test('PATCH não permite fase sem histórico nem alteração direta de espécie', () => {
  assert.equal(schemas.plantaPatchSchema.safeParse({}).success, false);
  assert.equal(schemas.plantaPatchSchema.safeParse({ faseAtual: 'ADULTA' }).success, false);
  assert.equal(schemas.plantaPatchSchema.safeParse({ especieId: randomUUID() }).success, false);
  assert.equal(schemas.plantaPatchSchema.safeParse({ apelido: null }).success, true);
});

test('paginação e filtros rejeitam booleanos ambíguos, arrays e limites excessivos', () => {
  assert.equal(schemas.plantaQuerySchema.safeParse({ arquivadas: 'yes' }).success, false);
  assert.equal(schemas.plantaQuerySchema.safeParse({ limite: 101 }).success, false);
  assert.equal(schemas.plantaQuerySchema.safeParse({ pagina: 0 }).success, false);
  assert.equal(schemas.plantaQuerySchema.safeParse({ busca: ['a', 'b'] }).success, false);
  assert.equal(schemas.plantaQuerySchema.parse({ arquivadas: 'false' }).arquivadas, false);
});

test('crescimento rejeita datas futuras, altura negativa e intervalo invertido', () => {
  assert.equal(schemas.crescimentoCreateSchema.safeParse({ fase: 'MUDA', alturaCm: -1 }).success, false);
  assert.equal(schemas.crescimentoCreateSchema.safeParse({ fase: 'MUDA', registradoEm: '2099-01-01T00:00:00Z' }).success, false);
  assert.equal(schemas.crescimentoQuerySchema.safeParse({ de: '2026-10-17T00:00:00Z', ate: '2026-10-16T00:00:00Z' }).success, false);
});
