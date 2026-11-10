const { randomUUID } = require('node:crypto');
const schemas = require('../../src/validators/plantaValidators');

test('planta rejeita atribuição de dono, confiança, status e fase inválida', () => {
  const base = { nome: 'Minha planta', faseAtual: 'SEMENTE' };
  for (const fields of [{ usuarioId: randomUUID() }, { statusIdentificacao: 'IDENTIFICADA' },
    { confiancaIdentificacao: 1 }, { faseAtual: 'INVENTADA' }, { dataPlantio: '2026-02-30' }]) {
    expect(schemas.plantaCreateSchema.safeParse({ ...base, ...fields }).success).toBe(false);
  }
  expect(schemas.plantaCreateSchema.safeParse(base).success).toBe(true);
});

test('PATCH não permite fase sem histórico nem alteração direta de espécie', () => {
  expect(schemas.plantaPatchSchema.safeParse({}).success).toBe(false);
  expect(schemas.plantaPatchSchema.safeParse({ faseAtual: 'ADULTA' }).success).toBe(false);
  expect(schemas.plantaPatchSchema.safeParse({ especieId: randomUUID() }).success).toBe(false);
  expect(schemas.plantaPatchSchema.safeParse({ apelido: null }).success).toBe(true);
});

test('paginação e filtros rejeitam booleanos ambíguos, arrays e limites excessivos', () => {
  expect(schemas.plantaQuerySchema.safeParse({ arquivadas: 'yes' }).success).toBe(false);
  expect(schemas.plantaQuerySchema.safeParse({ limite: 101 }).success).toBe(false);
  expect(schemas.plantaQuerySchema.safeParse({ pagina: 0 }).success).toBe(false);
  expect(schemas.plantaQuerySchema.safeParse({ busca: ['a', 'b'] }).success).toBe(false);
  expect(schemas.plantaQuerySchema.parse({ arquivadas: 'false' }).arquivadas).toBe(false);
});

test('crescimento rejeita datas futuras, altura negativa e intervalo invertido', () => {
  expect(schemas.crescimentoCreateSchema.safeParse({ fase: 'MUDA', alturaCm: -1 }).success).toBe(false);
  expect(schemas.crescimentoCreateSchema.safeParse({ fase: 'MUDA', registradoEm: '2099-01-01T00:00:00Z' }).success).toBe(false);
  expect(schemas.crescimentoQuerySchema.safeParse({ de: '2026-10-17T00:00:00Z', ate: '2026-10-16T00:00:00Z' }).success).toBe(false);
});
