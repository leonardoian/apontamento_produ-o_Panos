import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "superpro_secret_2026";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const R = (body, status = 200) => ({
  statusCode: status,
  headers: { ...cors, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const E = (msg, status = 400) => R({ error: msg }, status);

function auth(event) {
  const h = (event.headers?.authorization || event.headers?.Authorization || "");
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); } catch { return null; }
}

async function initDB(sql) {
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    login VARCHAR(50) UNIQUE NOT NULL,
    senha_hash VARCHAR(100) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    perfil VARCHAR(20) DEFAULT 'operador',
    ativo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS referencias (
    id SERIAL PRIMARY KEY,
    cod VARCHAR(30) UNIQUE NOT NULL,
    descricao VARCHAR(200) NOT NULL,
    ativo BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS programa (
    id SERIAL PRIMARY KEY,
    mes_ano VARCHAR(7) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    meta_turno INT DEFAULT 0,
    num_turnos INT DEFAULT 2,
    ativo BOOLEAN DEFAULT true,
    UNIQUE(mes_ano, ref_cod)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS lancamentos (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    turno VARCHAR(5) NOT NULL,
    ref_cod VARCHAR(30) NOT NULL,
    descricao VARCHAR(200),
    operador VARCHAR(100),
    realizado INT DEFAULT 0,
    meta INT DEFAULT 0,
    refugo INT DEFAULT 0,
    eficiencia NUMERIC(6,4),
    hora_inicio VARCHAR(5),
    hora_fim VARCHAR(5),
    obs TEXT,
    usuario_login VARCHAR(50),
    criado_em TIMESTAMP DEFAULT NOW()
  )`;
  const existe = await sql`SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1`;
  if (!existe.length) {
    const hash = await bcrypt.hash("admin123", 10);
    await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil)
      VALUES ('admin', ${hash}, 'Administrador', 'admin')`;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  if (!process.env.DATABASE_URL) return E("DATABASE_URL não configurada", 500);

  let sql;
  try { sql = neon(process.env.DATABASE_URL); } catch(e) { return E("Erro conexão: " + e.message, 500); }

  try { await initDB(sql); } catch(e) { return E("Erro initDB: " + e.message, 500); }

  const raw = event.path || "";
  const path = raw
    .replace(/^\/\.netlify\/functions\/api/, "")
    .replace(/^\/api/, "")
    .replace(/^\//, "")
    .split("?")[0];
  const method = event.httpMethod;
  let body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch {}
  const qs = event.queryStringParameters || {};

  console.log(method, path, "db:", !!process.env.DATABASE_URL);

  // LOGIN
  if (path === "login" && method === "POST") {
    const { login, senha } = body;
    if (!login || !senha) return E("Login e senha obrigatórios");
    try {
      const rows = await sql`SELECT * FROM usuarios WHERE login = ${login} AND ativo = true LIMIT 1`;
      if (!rows.length) return E("Usuário não encontrado", 401);
      const u = rows[0];
      const ok = await bcrypt.compare(senha, u.senha_hash);
      if (!ok) return E("Senha incorreta", 401);
      const token = jwt.sign({ login: u.login, nome: u.nome, perfil: u.perfil }, JWT_SECRET, { expiresIn: "12h" });
      return R({ token, usuario: { login: u.login, nome: u.nome, perfil: u.perfil } });
    } catch(e) { return E("Erro login: " + e.message, 500); }
  }

  // ME
  if (path === "me" && method === "GET") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    return R(u);
  }

  // MESES
  if (path === "meses" && method === "GET") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    try {
      const rows = await sql`SELECT DISTINCT mes_ano FROM programa WHERE ativo = true ORDER BY mes_ano DESC`;
      return R(rows.map(r => r.mes_ano));
    } catch(e) { return E("Erro meses: " + e.message, 500); }
  }

  // REFERENCIAS
  if (path === "referencias") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    if (method === "GET") {
      try {
        const rows = await sql`SELECT cod, descricao FROM referencias WHERE ativo = true ORDER BY cod`;
        return R(rows);
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "POST") {
      if (u.perfil !== "admin") return E("Acesso negado", 403);
      const { cod, descricao } = body;
      if (!cod || !descricao) return E("cod e descricao obrigatórios");
      try {
        await sql`INSERT INTO referencias (cod, descricao) VALUES (${cod.toUpperCase()}, ${descricao})
          ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, ativo = true`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return E("Acesso negado", 403);
      try {
        await sql`UPDATE referencias SET ativo = false WHERE cod = ${body.cod}`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
  }

  // PROGRAMA
  if (path === "programa") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    if (method === "GET") {
      const mes = qs.mes || "";
      try {
        const rows = mes
          ? await sql`SELECT p.id, p.mes_ano, p.ref_cod, p.meta_turno, p.num_turnos,
              (p.meta_turno * p.num_turnos) AS meta_total, r.descricao
              FROM programa p JOIN referencias r ON r.cod = p.ref_cod
              WHERE p.mes_ano = ${mes} AND p.ativo = true ORDER BY r.cod`
          : await sql`SELECT p.id, p.mes_ano, p.ref_cod, p.meta_turno, p.num_turnos,
              (p.meta_turno * p.num_turnos) AS meta_total, r.descricao
              FROM programa p JOIN referencias r ON r.cod = p.ref_cod
              WHERE p.ativo = true ORDER BY p.mes_ano, r.cod`;
        return R(rows);
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "POST") {
      if (u.perfil !== "admin") return E("Acesso negado", 403);
      const { mes_ano, ref_cod, meta_turno, num_turnos } = body;
      if (!mes_ano || !ref_cod) return E("mes_ano e ref_cod obrigatórios");
      try {
        await sql`INSERT INTO programa (mes_ano, ref_cod, meta_turno, num_turnos)
          VALUES (${mes_ano}, ${ref_cod.toUpperCase()}, ${meta_turno || 0}, ${num_turnos || 2})
          ON CONFLICT (mes_ano, ref_cod) DO UPDATE
          SET meta_turno = EXCLUDED.meta_turno, num_turnos = EXCLUDED.num_turnos, ativo = true`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return E("Acesso negado", 403);
      try {
        await sql`UPDATE programa SET ativo = false WHERE mes_ano = ${body.mes_ano} AND ref_cod = ${body.ref_cod}`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
  }

  // LANCAMENTOS
  if (path === "lancamentos") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    if (method === "GET") {
      const { mes, turno, ref } = qs;
      try {
        let rows;
        if (mes && turno && ref) {
          rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} AND turno = ${turno} AND ref_cod = ${ref} ORDER BY data DESC, criado_em DESC`;
        } else if (mes && turno) {
          rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} AND turno = ${turno} ORDER BY data DESC, criado_em DESC`;
        } else if (mes) {
          rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} ORDER BY data DESC, criado_em DESC`;
        } else {
          rows = await sql`SELECT * FROM lancamentos ORDER BY criado_em DESC LIMIT 100`;
        }
        return R(rows);
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "POST") {
      const { data, turno, ref_cod, descricao, operador, realizado, meta, refugo, hora_inicio, hora_fim, obs } = body;
      if (!data || !turno || !ref_cod) return E("data, turno e ref_cod obrigatórios");
      const efic = meta > 0 ? (realizado / meta).toFixed(4) : null;
      try {
        const row = await sql`INSERT INTO lancamentos
          (data, turno, ref_cod, descricao, operador, realizado, meta, refugo, eficiencia, hora_inicio, hora_fim, obs, usuario_login)
          VALUES (${data}, ${turno}, ${ref_cod}, ${descricao||""}, ${operador||""}, ${realizado||0}, ${meta||0},
                  ${refugo||0}, ${efic}, ${hora_inicio||""}, ${hora_fim||""}, ${obs||""}, ${u.login})
          RETURNING id`;
        return R({ ok: true, id: row[0].id });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return E("Acesso negado", 403);
      try {
        await sql`DELETE FROM lancamentos WHERE id = ${body.id}`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
  }

  // DASHBOARD
  if (path === "dashboard" && method === "GET") {
    const u = auth(event);
    if (!u) return E("Não autorizado", 401);
    const mes = qs.mes || new Date().toISOString().slice(0, 7);
    try {
      const [totais] = await sql`
        SELECT
          COALESCE(SUM(realizado),0)::int AS total_realizado,
          COALESCE(SUM(refugo),0)::int    AS total_refugo,
          COUNT(*)::int                   AS total_lancamentos,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes}`;

      const prog = await sql`
        SELECT p.ref_cod AS cod, r.descricao,
          (p.meta_turno * p.num_turnos) AS meta_total,
          COALESCE(SUM(l.realizado),0)::int AS realizado,
          COALESCE(SUM(l.refugo),0)::int    AS refugo,
          p.num_turnos, p.meta_turno
        FROM programa p
        JOIN referencias r ON r.cod = p.ref_cod
        LEFT JOIN lancamentos l ON l.ref_cod = p.ref_cod AND TO_CHAR(l.data,'YYYY-MM') = ${mes}
        WHERE p.mes_ano = ${mes} AND p.ativo = true
        GROUP BY p.id, p.ref_cod, r.descricao, p.meta_turno, p.num_turnos
        ORDER BY r.cod`;

      const turnos = await sql`
        SELECT turno,
          COALESCE(SUM(realizado),0)::int AS realizado,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
        GROUP BY turno ORDER BY turno`;

      const recentes = await sql`
        SELECT data, turno, ref_cod, operador, realizado, eficiencia
        FROM lancamentos ORDER BY criado_em DESC LIMIT 8`;

      return R({ totais, prog, turnos, recentes });
    } catch(e) { return E("Erro dashboard: " + e.message, 500); }
  }

  // USUARIOS
  if (path === "usuarios") {
    const u = auth(event);
    if (!u || u.perfil !== "admin") return E("Acesso negado", 403);
    if (method === "GET") {
      try {
        const rows = await sql`SELECT id, login, nome, perfil, ativo FROM usuarios ORDER BY id`;
        return R(rows);
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "POST") {
      const { login, senha, nome, perfil } = body;
      if (!login || !senha || !nome) return E("Campos obrigatórios");
      try {
        const hash = await bcrypt.hash(senha, 10);
        await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil) VALUES (${login}, ${hash}, ${nome}, ${perfil || "operador"})`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
    if (method === "DELETE") {
      if (body.login === "admin") return E("Não pode remover o admin");
      try {
        await sql`UPDATE usuarios SET ativo = false WHERE login = ${body.login}`;
        return R({ ok: true });
      } catch(e) { return E("Erro: " + e.message, 500); }
    }
  }

  return E("Rota não encontrada: " + path, 404);
};
