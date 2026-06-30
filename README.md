# Superpro — Sistema de Apontamento de Produção

Sistema web para controle de produção da **SuperPro**. Registra apontamentos por turno, calcula eficiência por operador, monitora metas mensais e gera relatórios exportáveis em Excel e PDF.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS (SPA, sem framework) |
| Backend | Vercel Serverless Functions (ES Modules) |
| Banco de dados | Neon (PostgreSQL serverless) |
| Autenticação | JWT + bcryptjs |
| Exportação | SheetJS (xlsx) + jsPDF + jspdf-autotable |
| Deploy | Vercel |

---

## Configuração local

### Pré-requisitos

- Node.js 18+
- Conta no [Neon](https://neon.tech) com banco PostgreSQL criado
- Vercel CLI instalada globalmente: `npm i -g vercel`

### Variáveis de ambiente

Crie um arquivo `.env` na raiz com base no `.env.example`:

```env
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
JWT_SECRET=troque_por_uma_string_aleatoria_longa
```

> **Atenção:** o sistema recusa inicializar se qualquer uma dessas variáveis estiver ausente — não há fallback hardcoded.

### Rodando localmente

```bash
npm install
vercel dev
```

Acesse `http://localhost:3000`.

---

## Deploy (Vercel)

1. Conecte o repositório na [Vercel](https://vercel.com)
2. Adicione as variáveis `DATABASE_URL` e `JWT_SECRET` nas configurações do projeto
3. Deploy automático a cada push na branch `main`

---

## Estrutura do projeto

```
/
├── vercel.json              # Rotas (SPA fallback → index.html)
├── package.json
├── .env.example
├── api/
│   ├── _lib/
│   │   └── db.mjs           # Conexão Neon, helpers de auth e CORS
│   ├── login.mjs            # Autenticação (POST /api/login)
│   ├── me.mjs               # Usuário autenticado (GET /api/me)
│   ├── usuarios.mjs         # CRUD de usuários
│   ├── referencias.mjs      # CRUD de referências de produtos
│   ├── programa.mjs         # Programa mensal por célula
│   ├── lancamentos.mjs      # Apontamentos de produção
│   ├── dashboard.mjs        # KPIs e dados consolidados
│   ├── operadores.mjs       # Eficiência por operador
│   └── meses.mjs            # Meses com lançamentos
└── public/
    ├── index.html           # Aplicação principal (SPA)
    ├── style.css            # Estilos (dark theme, responsivo)
    └── importar.html        # Importação de programa via planilha Excel
```

---

## Funcionalidades

### Células de trabalho

O sistema suporta múltiplas células independentes, cada uma com programa e referências próprias:

- Celular de Alumínio
- Máquina de Panos
- Máquina de Placas
- Máquina de Rodos
- Trabalho Manual

### Dashboard

- KPIs do mês: total realizado, meta, refugo, eficiência média
- Gráficos de atingimento por referência (donut Chart.js)
- Comparativo meta vs. realizado por turno
- Últimos lançamentos
- **Exportação para Excel** (4 abas: Resumo, Meta vs Realizado, Por Turno, Últimos Lançamentos)
- **Exportação para PDF** com tabelas formatadas

### Apontamento de produção

- Formulário por turno (T1/T2) com referência, realizado, meta, refugo e horário
- O campo **Operador** é preenchido automaticamente com o nome do usuário logado (readonly) — garante consistência no relatório de eficiência
- Eficiência calculada automaticamente com base nas horas trabalhadas

### Relatório de Operadores

- Aba dedicada com ranking de produção por operador no mês
- Filtro por célula
- Colunas: Matrícula, Nome, Total Realizado, Lançamentos, Eficiência Média, Realizado T1, Realizado T2, Refugo
- **Exportação para Excel e PDF**

### Importação de planilha

Acesse `/importar.html` para importar programas mensais via `.xlsx`.

A planilha deve conter as colunas: `MÊS/ANO`, `CELULA`, `COD_REF`, meta por turno e número de turnos.

### Interface

- Dark theme com variáveis CSS customizadas
- **Responsivo para mobile**: sidebar colapsável com botão hamburguer, formulários em coluna única em telas pequenas
- Sidebar se fecha automaticamente ao navegar em dispositivos móveis

---

## Cálculo de eficiência

```
Eficiência = Realizado ÷ (Meta/hora × Horas trabalhadas)
```

Se `hora_inicio` e `hora_fim` não forem preenchidos, o sistema usa a meta do turno como fallback.

---

## Banco de dados

### `usuarios`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `login` | VARCHAR | Login único |
| `nome` | VARCHAR | Nome completo |
| `senha_hash` | TEXT | Senha com bcrypt |
| `role` | VARCHAR | `admin` ou `operador` |
| `ativo` | BOOLEAN | |

### `referencias`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `cod` | VARCHAR | Código (ex: SP2745LR) |
| `descricao` | TEXT | Descrição do produto |
| `meta_hora` | INT | Meta de peças/hora |
| `ativo` | BOOLEAN | |

### `programa`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `mes_ano` | VARCHAR | Formato `YYYY-MM` |
| `ref_cod` | VARCHAR | Código da referência |
| `celula` | VARCHAR | Célula/Setor (default: `Panos`) |
| `meta_turno` | INT | Meta de peças por turno |
| `num_turnos` | INT | Número de turnos no mês |
| `ativo` | BOOLEAN | |

> Constraint única: `(mes_ano, ref_cod, celula)`

### `lancamentos`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `data` | DATE | Data do apontamento |
| `turno` | VARCHAR | `T1` ou `T2` |
| `ref_cod` | VARCHAR | Referência |
| `operador` | VARCHAR | Nome do operador (usuário logado) |
| `realizado` | INT | Peças realizadas |
| `meta` | INT | Meta de peças |
| `refugo` | INT | Peças refugadas |
| `eficiencia` | FLOAT | Eficiência (0.0 – 1.0+) |
| `hora_inicio` | TIME | |
| `hora_fim` | TIME | |
| `obs` | TEXT | Observações |
| `usuario_login` | VARCHAR | Login de quem registrou |
| `criado_em` | TIMESTAMP | Timestamp automático |

---

## API

Todos os endpoints requerem o header `Authorization: Bearer <token>`, exceto `/api/login`.

### Autenticação

```
POST /api/login
Body: { "login": "user", "senha": "pass" }
```

### Usuário logado

```
GET /api/me
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
GET    /api/lancamentos?mes=2026-06&celula=Panos&turno=T1&ref=SP2745LR
POST   /api/lancamentos
Body: {
  "data": "2026-06-24",
  "turno": "T1",
  "ref_cod": "SP2745LR",
  "operador": "João Silva",
  "realizado": 80,
  "meta": 80,
  "refugo": 0,
  "hora_inicio": "08:00",
  "hora_fim": "09:00",
  "obs": "",
  "eficiencia": 1.0
}
DELETE /api/lancamentos?id=123
```

### Dashboard

```
GET /api/dashboard?mes=2026-06&celula=Panos
```

### Operadores

```
GET /api/operadores?mes=2026-06&celula=Panos
```

### Meses disponíveis

```
GET /api/meses
```
