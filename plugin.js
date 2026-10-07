export async function home() {
  return [];
}

export async function browse() {
  return { items: [] };
}

export async function resolve() {
  throw kino.error(
    "unavailable",
    "Este plugin ha sido retirado por su autor"
  );
}

export async function section() {
  return {
    tabs: [],
    rows: []
  };
}

export async function action() {
  return { message: "Este plugin ha sido retirado por su autor" };
}
