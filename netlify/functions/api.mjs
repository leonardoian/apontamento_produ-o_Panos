import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET || "superpro_secret_2026";

// ── CORS helper
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function ok(body, status = 200) {
  return { statusCode: status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function err(msg, status = 400) {
  return { statusCode: status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: msg }) };
}

// ── Auth middleware
function auth(event) {
  const h = event.headers?.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); }
  catch { return null; }
}

// ── Init DB (cria tabelas se não existem)
async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      login VARCHAR(50) UNIQUE NOT NULL,
      senha_hash VARCHAR(100) NOT NULL,
      nome VARCHAR(100) NOT NULL,
      perfil VARCHAR(20) DEFAULT 'operador',
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS referencias (
      id SERIAL PRIMARY KEY,
      cod VARCHAR(30) UNIQUE NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS programa (
      id SERIAL PRIMARY KEY,
      mes_ano VARCHAR(7) NOT NULL,
      ref_cod VARCHAR(30) NOT NULL REFERENCES referencias(cod),
      meta_turno INT DEFAULT 0,
      num_turnos INT DEFAULT 2,
      meta_total INT GENERATED ALWAYS AS (meta_turno * num_turnos) STORED,
      ativo BOOLEAN DEFAULT true,
      UNIQUE(mes_ano, ref_cod)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS lancamentos (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      turno VARCHAR(5) NOT NULL,
      ref_cod VARCHAR(30) NOT NULL,
      descricao VARCHAR(200),
      operador VARCHAR(100),
      realizado INT DEFAULT 0,
      meta INT DEFAULT 0,
      refugo INT DEFAULT 0,
      eficiencia NUMERIC(5,4),
      hora_inicio VARCHAR(5),
      hora_fim VARCHAR(5),
      obs TEXT,
      usuario_login VARCHAR(50),
      criado_em TIMESTAMP DEFAULT NOW()
    )`;

  // Admin padrão
  const existe = await sql`SELECT id FROM usuarios WHERE login = 'admin'`;
  if (existe.length === 0) {
    const hash = await bcrypt.hash("admin123", 10);
    await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil) VALUES ('admin', ${hash}, 'Administrador', 'admin')`;
  }
}

// ═══════════════════════════════════════════════════════════
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  try {
    await initDB();
  } catch (e) {
    return err("Erro ao inicializar banco: " + e.message, 500);
  }

  const path = event.path.replace("/.netlify/functions/api", "").replace(/^\//, "");
  const method = event.httpMethod;
  let body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch {}

  // ── POST /login
  if (path === "login" && method === "POST") {
    const { login, senha } = body;
    if (!login || !senha) return err("Login e senha obrigatórios");
    const rows = await sql`SELECT * FROM usuarios WHERE login = ${login} AND ativo = true`;
    if (!rows.length) return err("Usuário não encontrado", 401);
    const u = rows[0];
    const ok2 = await bcrypt.compare(senha, u.senha_hash);
    if (!ok2) return err("Senha incorreta", 401);
    const token = jwt.sign({ login: u.login, nome: u.nome, perfil: u.perfil }, JWT_SECRET, { expiresIn: "12h" });
    return ok({ token, usuario: { login: u.login, nome: u.nome, perfil: u.perfil } });
  }

  // ── GET /me
  if (path === "me" && method === "GET") {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);
    return ok(u);
  }

  // ══════════════ USUARIOS ══════════════
  if (path === "usuarios") {
    const u = auth(event);
    if (!u || u.perfil !== "admin") return err("Acesso negado", 403);

    if (method === "GET") {
      const rows = await sql`SELECT id, login, nome, perfil, ativo, criado_em FROM usuarios ORDER BY id`;
      return ok(rows);
    }
    if (method === "POST") {
      const { login, senha, nome, perfil } = body;
      if (!login || !senha || !nome) return err("Campos obrigatórios: login, senha, nome");
      const hash = await bcrypt.hash(senha, 10);
      await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil) VALUES (${login}, ${hash}, ${nome}, ${perfil || "operador"})`;
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      const { login } = body;
      if (login === "admin") return err("Não é possível remover o admin");
      await sql`UPDATE usuarios SET ativo = false WHERE login = ${login}`;
      return ok({ ok: true });
    }
  }

  // ══════════════ REFERENCIAS ══════════════
  if (path === "referencias") {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);

    if (method === "GET") {
      const rows = await sql`SELECT cod, descricao, ativo FROM referencias WHERE ativo = true ORDER BY cod`;
      return ok(rows);
    }
    if (method === "POST") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      const { cod, descricao } = body;
      if (!cod || !descricao) return err("Campos obrigatórios: cod, descricao");
      await sql`
        INSERT INTO referencias (cod, descricao) VALUES (${cod.toUpperCase()}, ${descricao})
        ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, ativo = true`;
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      await sql`UPDATE referencias SET ativo = false WHERE cod = ${body.cod}`;
      return ok({ ok: true });
    }
  }

  // ══════════════ PROGRAMA ══════════════
  if (path === "programa" || path.startsWith("programa/")) {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);

    if (method === "GET") {
      const mes = event.queryStringParameters?.mes || "";
      const rows = mes
        ? await sql`
            SELECT p.*, r.descricao FROM programa p
            JOIN referencias r ON r.cod = p.ref_cod
            WHERE p.mes_ano = ${mes} AND p.ativo = true ORDER BY r.cod`
        : await sql`
            SELECT p.*, r.descricao FROM programa p
            JOIN referencias r ON r.cod = p.ref_cod
            WHERE p.ativo = true ORDER BY p.mes_ano, r.cod`;
      return ok(rows);
    }
    if (method === "POST") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      const { mes_ano, ref_cod, meta_turno, num_turnos } = body;
      if (!mes_ano || !ref_cod) return err("Campos obrigatórios: mes_ano, ref_cod");
      await sql`
        INSERT INTO programa (mes_ano, ref_cod, meta_turno, num_turnos)
        VALUES (${mes_ano}, ${ref_cod.toUpperCase()}, ${meta_turno || 0}, ${num_turnos || 2})
        ON CONFLICT (mes_ano, ref_cod) DO UPDATE
        SET meta_turno = EXCLUDED.meta_turno, num_turnos = EXCLUDED.num_turnos, ativo = true`;
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      await sql`UPDATE programa SET ativo = false WHERE mes_ano = ${body.mes_ano} AND ref_cod = ${body.ref_cod}`;
      return ok({ ok: true });
    }
    if (method === "PUT") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      const { id, meta_turno, num_turnos } = body;
      await sql`UPDATE programa SET meta_turno = ${meta_turno}, num_turnos = ${num_turnos} WHERE id = ${id}`;
      return ok({ ok: true });
    }
  }

  // ══════════════ LANCAMENTOS ══════════════
  if (path === "lancamentos" || path.startsWith("lancamentos/")) {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);

    if (method === "GET") {
      const { mes, turno, ref } = event.queryStringParameters || {};
      let rows;
      if (mes && turno && ref) {
        rows = await sql`SELECT * FROM lancamentos WHERE DATE_TRUNC('month', data) = ${mes + "-01"}::date AND turno = ${turno} AND ref_cod = ${ref} ORDER BY data, criado_em`;
      } else if (mes && turno) {
        rows = await sql`SELECT * FROM lancamentos WHERE DATE_TRUNC('month', data) = ${mes + "-01"}::date AND turno = ${turno} ORDER BY data, criado_em`;
      } else if (mes) {
        rows = await sql`SELECT * FROM lancamentos WHERE DATE_TRUNC('month', data) = ${mes + "-01"}::date ORDER BY data DESC, criado_em DESC`;
      } else {
        rows = await sql`SELECT * FROM lancamentos ORDER BY data DESC, criado_em DESC LIMIT 200`;
      }
      return ok(rows);
    }
    if (method === "POST") {
      const { data, turno, ref_cod, descricao, operador, realizado, meta, refugo, hora_inicio, hora_fim, obs } = body;
      if (!data || !turno || !ref_cod) return err("Campos obrigatórios: data, turno, ref_cod");
      const efic = meta > 0 ? (realizado / meta).toFixed(4) : null;
      const row = await sql`
        INSERT INTO lancamentos (data, turno, ref_cod, descricao, operador, realizado, meta, refugo, eficiencia, hora_inicio, hora_fim, obs, usuario_login)
        VALUES (${data}, ${turno}, ${ref_cod}, ${descricao}, ${operador}, ${realizado || 0}, ${meta || 0}, ${refugo || 0}, ${efic}, ${hora_inicio}, ${hora_fim}, ${obs}, ${u.login})
        RETURNING id`;
      return ok({ ok: true, id: row[0].id });
    }
    if (method === "DELETE") {
      if (u.perfil !== "admin") return err("Acesso negado", 403);
      await sql`DELETE FROM lancamentos WHERE id = ${body.id}`;
      return ok({ ok: true });
    }
  }

  // ══════════════ DASHBOARD ══════════════
  if (path === "dashboard" && method === "GET") {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);
    const mes = event.queryStringParameters?.mes || new Date().toISOString().slice(0, 7);

    const [totais] = await sql`
      SELECT
        COALESCE(SUM(realizado),0) AS total_realizado,
        COALESCE(SUM(refugo),0)    AS total_refugo,
        COUNT(*)                   AS total_lancamentos,
        ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
      FROM lancamentos
      WHERE DATE_TRUNC('month', data) = ${mes + "-01"}::date`;

    const prog = await sql`
      SELECT p.ref_cod AS cod, r.descricao, p.meta_total,
        COALESCE(SUM(l.realizado),0) AS realizado,
        COALESCE(SUM(l.refugo),0) AS refugo,
        p.num_turnos, p.meta_turno
      FROM programa p
      JOIN referencias r ON r.cod = p.ref_cod
      LEFT JOIN lancamentos l ON l.ref_cod = p.ref_cod AND DATE_TRUNC('month', l.data) = ${mes + "-01"}::date
      WHERE p.mes_ano = ${mes} AND p.ativo = true
      GROUP BY p.ref_cod, r.descricao, p.meta_total, p.num_turnos, p.meta_turno
      ORDER BY r.cod`;

    const turnos = await sql`
      SELECT turno,
        COALESCE(SUM(realizado),0) AS realizado,
        ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
      FROM lancamentos
      WHERE DATE_TRUNC('month', data) = ${mes + "-01"}::date
      GROUP BY turno ORDER BY turno`;

    const recentes = await sql`
      SELECT data, turno, ref_cod, operador, realizado, eficiencia
      FROM lancamentos ORDER BY criado_em DESC LIMIT 8`;

    return ok({ totais, prog, turnos, recentes });
  }

  // ══════════════ MESES disponíveis ══════════════
  if (path === "meses" && method === "GET") {
    const u = auth(event);
    if (!u) return err("Não autorizado", 401);
    const rows = await sql`SELECT DISTINCT mes_ano FROM programa WHERE ativo = true ORDER BY mes_ano DESC`;
    return ok(rows.map(r => r.mes_ano));
  }

  return err("Rota não encontrada", 404);
};
