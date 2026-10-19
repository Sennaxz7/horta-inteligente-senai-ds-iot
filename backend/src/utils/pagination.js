function pageOptions({ pagina, limite }) {
  return { limit: limite, offset: (pagina - 1) * limite };
}

function paginated({ rows, count }, { pagina, limite }) {
  return {
    data: rows,
    meta: {
      pagina,
      limite,
      total: count,
      totalPaginas: Math.ceil(count / limite),
    },
  };
}

function literalSearch(value) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

module.exports = { pageOptions, paginated, literalSearch };
