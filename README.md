# Superpro — Sistema de Apontamento de Produção

Sistema web para controle de produção em múltiplas células de trabalho. Permite registrar apontamentos por turno, calcular eficiência baseada em horas trabalhadas e monitorar metas mensais.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS (SPA) |
| Backend | Vercel Serverless Functions (ES Modules) |
| Banco de dados | Neon (PostgreSQL serverless) |
| Autenticação | JWT + bcryptjs |
| Deploy | Vercel |

---

## Configuração local

### Pré-requisitos
- Node.js 18+
- Conta no [Neon](https://neon.tech) com banco PostgreSQL criado
- Vercel CLI (`npm i -g vercel`) para rodar localmente

### Variáveis de ambiente

Crie um arquivo `.env` na raiz com base no `.env.example`:

```env
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
JWT_SECRET=troque_por_uma_string_aleatoria_longa
```

### Rodando localmente

```bash
npm install
vercel dev
```

Acesse `http://localhost:3000`.

---

## Deploy (Vercel)

1. Conecte o repositório na [Vercel](https://vercel.com)
2. Adicione as variáveis de ambiente `DATABASE_URL` e `JWT_SECRET` nas configurações do projeto
3. Deploy automático a cada push na branch `main`

---

## Estrutura do projeto

```
/
├── vercel.json              # Configuração de rotas
├── package.json
├── .env.example
├── api/
│   ├── _lib/
│   │   └── db.mjs           # Conexão com o banco (Neon)
│   ├── login.mjs            # Autenticação
│   ├── me.mjs               # Usuário autenticado
│   ├── usuarios.mjs         # Gerenciamento de usuários
│   ├── referencias.mjs      # Referências de produtos
│   ├── programa.mjs         # Programa mensal por célula
│   ├── lancamentos.mjs      # Apontamentos de produção
│   ├── dashboard.mjs        # Dados consolidados
│   └── meses.mjs            # Meses disponíveis
└── public/
    ├── index.html           # Aplicação principal
    └── importar.html        # Importação via planilha Excel
```

---

## Funcionalidades

### Células de trabalho

O sistema suporta 5 células/setores independentes, cada uma com programa e referências próprias:

- Celular de Alumínio
- Máquina de Panos *(padrão)*
- Máquina de Placas
- Máquina de Rodos
- Trabalho Manual

### Cálculo de eficiência

A eficiência é calculada por horas efetivamente trabalhadas:

```
Eficiência = (Realizado ÷ (Meta Hora × Horas Trabalhadas)) × 100
```

**Exemplo:** meta de 80 pçs/h, trabalhando 1h e realizando 80 pçs → 100% de eficiência.

> Se `hora_inicio` e `hora_fim` não forem preenchidas, o sistema usa a meta do turno como fallback.

### Importação de planilha Excel

Acesse `/importar.html` para importar programas mensais via `.xlsx`.

A planilha deve conter as abas `REFERENCIAS` e `PROGRAMA` com a seguinte estrutura:

| MÊS/ANO | CELULA | COD_REF | Meta por Turno | Nº de Turnos |
|---------|--------|---------|----------------|--------------|
| 2026-06 | Panos | SP2745LR | 80 | 2 |
| 2026-06 | Aluminio | SP2824AZ | 100 | 2 |

A coluna `CELULA` é opcional — quando ausente, o padrão é `Panos`.

---

## Banco de dados

### `referencias`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | ID único |
| `cod` | VARCHAR | Código da referência (ex: SP2745LR) |
| `descricao` | TEXT | Descrição do produto |
| `meta_hora` | INT | Meta de peças por hora |
| `ativo` | BOOLEAN | Ativo/Inativo |

### `programa`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | ID único |
| `mes_ano` | VARCHAR | Mês no formato YYYY-MM |
| `ref_cod` | VARCHAR | Código da referência |
| `celula` | VARCHAR | Célula/Setor (default: `'Panos'`) |
| `meta_turno` | INT | Meta de peças por turno |
| `num_turnos` | INT | Número de turnos no mês |
| `ativo` | BOOLEAN | Ativo/Inativo |

> Constraint única: `(mes_ano, ref_cod, celula)` — a mesma referência pode existir em células diferentes.

### `lancamentos`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | ID único |
| `data` | DATE | Data do apontamento |
| `turno` | VARCHAR | T1 ou T2 |
| `ref_cod` | VARCHAR | Referência |
| `operador` | VARCHAR | Nome do operador |
| `realizado` | INT | Peças realizadas |
| `meta` | INT | Meta de peças |
| `refugo` | INT | Peças refugadas |
| `eficiencia` | FLOAT | Eficiência calculada (0.0 a 1.0) |
| `hora_inicio` | TIME | Hora de início |
| `hora_fim` | TIME | Hora de término |
| `obs` | TEXT | Observações |
| `usuario_login` | VARCHAR | Login de quem registrou |
| `criado_em` | TIMESTAMP | Timestamp de criação |

---

## API

Todos os endpoints exigem autenticação via JWT no header `Authorization: Bearer <token>`, exceto `/api/login`.

### Autenticação

```
POST /api/login
Body: { "login": "user", "senha": "pass" }
```

### Referências

```
GET  /api/referencias
POST /api/referencias
Body: { "cod": "SP2745LR", "descricao": "...", "meta_hora": 80 }
```

### Programa mensal

```
GET  /api/programa?mes=2026-06&celula=Panos
POST /api/programa
Body: { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos", "meta_turno": 80, "num_turnos": 2 }
```

### Lançamentos

```
GET  /api/lancamentos?mes=2026-06&celula=Panos&turno=T1&ref=SP2745LR
POST /api/lancamentos
Body: {
  "data": "2026-06-24",
  "turno": "T1",
  "ref_cod": "SP2745LR",
  "operador": "João",
  "realizado": 80,
  "meta": 80,
  "refugo": 0,
  "hora_inicio": "08:00",
  "hora_fim": "09:00",
  "obs": "Sem paradas",
  "eficiencia": 1.0
}
```

### Dashboard

```
GET /api/dashboard?mes=2026-06&celula=Panos
```

### Meses disponíveis

```
GET /api/meses
```
