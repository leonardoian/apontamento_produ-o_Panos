# Superpro — Sistema de Apontamento de Produção

Sistema web para controle de produção da **SuperPro**. Registra apontamentos por turno, calcula eficiência por operador, monitora metas mensais e gera relatórios exportáveis em Excel e PDF.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS (SPA, sem framework) |
| Backend | Vercel Serverless Functions (ES Modules) |
| Banco de dados | Neon (PostgreSQL serverless) |
| Autenticação | JWT + bcryptjs |
| Gráficos | Chart.js 4.4.0 |
| Exportação | SheetJS (xlsx@0.18.5) + jsPDF@2.5.1 + jspdf-autotable |
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
│   │   └── db.mjs           # Conexão Neon, helpers de auth, CORS e initDB
│   ├── login.mjs            # POST /api/login
│   ├── usuarios.mjs         # CRUD + /api/me + /api/senha + colegas (?recurso=)
│   ├── referencias.mjs      # CRUD de referências de produtos
│   ├── programa.mjs         # Programa mensal por célula
│   ├── lancamentos.mjs      # Apontamentos (GET / POST / PUT / DELETE)
│   ├── ordens.mjs           # Ordens de produção (GET / POST / DELETE)
│   ├── dashboard.mjs        # KPIs e dados consolidados + /api/meses (?recurso=)
│   ├── operadores.mjs       # Eficiência por operador
│   ├── estoque.mjs          # Estoque por CD / depósito + histórico
│   └── agenda.mjs           # Agenda: tarefas, metas e estatísticas (?recurso=tarefas|metas|stats)
└── public/
    ├── index.html           # Aplicação principal (SPA)
    ├── style.css            # Estilos (dark theme, responsivo)
    ├── importar.html        # Importação de programa via planilha Excel
    └── favicon.svg
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
- Importação

### Dashboard

- **5 KPI cards**: Total Realizado, Meta do Mês, Atingimento (%), Eficiência Média, Total Refugo
- Comparativo meta vs. realizado por referência com barra de progresso
- Resumo por turno (T1, T2, ADM)
- Últimos lançamentos
- Referências com `meta = 0` são ocultadas automaticamente
- **Exportação para Excel** (4 abas: Resumo, Meta vs Realizado, Por Turno, Últimos Lançamentos)
- **Exportação para PDF** com tabelas formatadas

### Programa do Mês

- Listagem das referências do mês com meta, realizado por turno, total, **quantidade que falta** e percentual
- Referências com `meta = 0` são ocultadas
- **Alerta visual**: linhas com menos de 60% de atingimento nos últimos 10 dias do mês ficam em destaque vermelho com ícone ⚠
- Exclusão de referência do programa (admin)
- Adição de referência ao programa (admin)

### Ordens de Produção

Aba visível a todos os usuários. Admin cria as ordens; operadores visualizam e acompanham o progresso.

**Criação (admin):**
- Seleciona célula → carrega automaticamente as referências com `meta_hora` cadastrada
- Seleciona referência → `meta_hora` preenchida automaticamente (editável)
- Informa a quantidade e as horas por turno (padrão 8h, configurável por ordem)
- O sistema calcula e exibe em tempo real: **Horas necessárias** e **Dias estimados**
- Campo de data prevista e observação opcionais

**Cards de acompanhamento (todos):**
- Status automático: `pendente` → `em andamento` → `concluída` (baseado nos lançamentos registrados após a criação da ordem)
- Barra de progresso com peças realizadas vs. quantidade da ordem
- Filtros por status e por célula
- Admin pode remover uma ordem com o botão ✕

### Lançamento de Produção

- Formulário com busca de referência por código ou descrição (dropdown filtrado)
- Turno: **T1**, **T2** ou **ADM**
- Campo **Operador** preenchido automaticamente com o usuário logado (readonly)
- Eficiência calculada automaticamente com base nas horas trabalhadas e meta/hora
- **Toast de confirmação** ao salvar (verde) ou erro (vermelho)
- **Painel "Seus lançamentos de hoje"**: exibe os últimos lançamentos do dia do usuário abaixo do formulário após cada salvamento

### Histórico

- Filtros por célula, mês, turno e referência
- Listagem com data, turno, referência, operador, realizado, meta, refugo, eficiência, horários e obs
- **Admin**: botão de edição (✎) que abre modal para corrigir qualquer campo do lançamento
- **Admin**: botão de exclusão (✕) com confirmação

### Gráficos por Célula

- Gráfico de rosca (doughnut) por célula mostrando atingimento do mês
- Exibe: Meta Total, Realizado, Eficiência Média e percentual de Atingimento

### Relatório de Operadores

- Ranking de produção por operador no mês
- Filtro por célula
- Colunas: Matrícula, Nome, Total Realizado, Lançamentos, Eficiência Média, Realizado T1/T2/ADM, Refugo
- **Exportação para Excel e PDF**

### Agenda de Tarefas

Módulo de organização do dia a dia, separado da produção de máquina. Uma aba na sidebar com quatro visões:

**Dia** — a agenda do dia escolhido (setas ‹ › e botão *Hoje* para navegar):
- Campo de **adição rápida**: digita o título, aperta Enter e a tarefa entra no dia
- Modal completo para título, descrição, data, prioridade (alta/média/baixa) e célula opcional
- Três ações por tarefa: **✔ Feita**, **✕ Não feita** (com motivo) e **→ Adiar** (amanhã, depois de amanhã, próxima segunda ou data escolhida)
- Adiar empurra a data e soma em `adiamentos` — o selo *adiada 2×* fica visível e a `data_original` é preservada
- Faixa **⚠ Atrasadas**: pendentes de dias anteriores, com botão para trazer todas para o dia atual
- 5 KPIs do dia: Feitas, Pendentes, Não Feitas, Adiadas e % de conclusão

**Calendário** — grade mensal com os contadores de cada dia (verde/vermelho/cinza) e barra de conclusão; clicar num dia abre aquele dia na aba Dia.

**Metas** — cada usuário cria as suas; o admin também pode atribuir metas a qualquer pessoa. Dois tipos:
- `tarefas`: alvo em quantidade de tarefas concluídas no dia/semana/mês, com filtro opcional por célula — **o progresso sobe sozinho** conforme as tarefas são marcadas como feitas
- `numerica`: alvo livre (ex: "reduzir refugo para 2%") com o valor atual atualizado à mão no próprio card

#### Tarefas e metas de mais de uma pessoa

Qualquer usuário pode marcar colegas ao criar uma tarefa ou meta (a lista de nomes vem de `usuarios?recurso=colegas`, que devolve só login e nome).

**Tarefa compartilhada** tem dois modos, escolhidos no checkbox *"cada participante marca o seu"*:

| Modo | Comportamento |
|------|---------------|
| **Trabalho único** (padrão) | Quem marcar como feita fecha para todos, e a linha ganha o selo *feita por Maria*. Adiar também move o dia de todo mundo. |
| **Cada um o seu** | Cada participante tem status e adiamento próprios. A linha mostra `✔ João ○ Maria ○ Pedro` e o contador *1 concluiu*. |

**Meta de grupo**: um alvo só, e o progresso é a soma da contribuição de todos — o card mostra a quebra por pessoa (`👥 João 30 · Maria 25 · Pedro 13`).

> **Crédito:** numa tarefa de trabalho único, o "feita" conta para quem marcou (`tarefas.concluida_por`). Sem essa regra, uma tarefa de 3 pessoas fechada uma vez contaria **3×** no comparativo da equipe e na meta do grupo. Na agenda de quem não marcou ela some das pendências e aparece no gráfico como *fechadas por colegas*, fora do total.

> **Quem pode o quê:** participante age no próprio status, adia e pode **sair** da tarefa (o `DELETE` dele remove só a própria participação). Editar, trocar a equipe ou excluir de vez é do admin, de quem criou ou do responsável. O responsável nunca é removido da própria tarefa.

**Gráfico** — evolução das atividades no período (7 dias, 30 dias, mês ou intervalo livre):
- Barras empilhadas por dia (feitas / não feitas / pendentes)
- Rosca de conclusão do período com o percentual no centro
- Barras horizontais de tarefas feitas por célula
- **Admin**: comparativo da equipe inteira (`Toda a equipe`) e exportação para Excel e PDF

> **Visibilidade:** o operador vê e altera apenas a própria agenda — se enviar `usuario=outro` na API, o parâmetro é ignorado. O admin tem um seletor *Agenda de* para abrir a agenda de qualquer usuário.

### Referências (admin)

- Cadastro de novas referências com código, descrição, célula e meta hora
- Listagem com busca por código ou descrição
- Edição inline de meta hora e célula
- **Exclusão em lote**: seleção múltipla via checkbox com botão "Apagar selecionadas"

### Usuários (admin)

- Cadastro de usuários com login, senha, nome e perfil (operador/admin)
- Listagem e exclusão (exceto o usuário `admin`)
- Botão 🔑 em cada linha para redefinir a senha do usuário sem precisar da senha atual

### Alteração de Senha

- Qualquer usuário logado pode alterar a própria senha pelo botão **🔑 Alterar Senha** na sidebar
- Exige a senha atual para confirmar a identidade
- Admin pode redefinir a senha de qualquer usuário pela tabela de Usuários (sem exigir senha atual)
- Senha mínima de 6 caracteres; confirmação obrigatória

### Importação de planilha

Acesse `/importar.html` para importar programas mensais via `.xlsx`.

A planilha deve conter as colunas: `MÊS/ANO`, `CELULA`, `COD_REF`, meta por turno e número de turnos.

> Para meses com apenas turno ADM, use `Nº DE TURNOS = 1` — a meta total será `Meta/Turno × 1`.

### Interface

- Dark theme com variáveis CSS customizadas
- Crédito de desenvolvimento visível na tela de login (canto inferior direito)
- **Responsivo para mobile**: sidebar colapsável com botão hamburguer, formulários em coluna única
- Sidebar fecha automaticamente ao navegar em dispositivos móveis
- **Toasts**: notificações animadas de sucesso, erro e informação no canto inferior direito

---

## Cálculo de eficiência

```
Eficiência = Realizado ÷ (Meta/hora × Horas trabalhadas)
```

Se `hora_inicio` e `hora_fim` não forem preenchidos, o sistema usa a meta do turno como fallback. O turno ADM entra no cálculo exatamente como T1 e T2.

---

## Banco de dados

As tabelas são criadas automaticamente na primeira requisição via `initDB()`.

### `usuarios`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `login` | VARCHAR | Login único |
| `nome` | VARCHAR | Nome completo |
| `senha_hash` | TEXT | Senha com bcrypt |
| `perfil` | VARCHAR | `admin` ou `operador` |
| `ativo` | BOOLEAN | Soft-delete |

### `referencias`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `cod` | VARCHAR | Código único (ex: SP2745LR) |
| `descricao` | TEXT | Descrição do produto |
| `meta_hora` | INT | Meta de peças/hora (opcional) |
| `celula` | VARCHAR | Célula padrão (default: `Panos`) |
| `ativo` | BOOLEAN | Soft-delete |

### `programa`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `mes_ano` | VARCHAR | Formato `YYYY-MM` |
| `ref_cod` | VARCHAR | Código da referência |
| `celula` | VARCHAR | Célula/Setor |
| `meta_turno` | INT | Meta de peças por turno |
| `num_turnos` | INT | Número de turnos planejados no mês |
| `ativo` | BOOLEAN | Soft-delete |

> Constraint única: `(mes_ano, ref_cod, celula)`

### `ordens_producao`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `celula` | VARCHAR | Célula/máquina alvo |
| `ref_cod` | VARCHAR | Referência a produzir |
| `quantidade` | INT | Peças a produzir |
| `meta_hora` | INT | Meta de peças/hora usada no cálculo |
| `horas_por_turno` | DECIMAL | Horas por turno (configurável, default: 8) |
| `data_prevista` | DATE | Data alvo (opcional) |
| `obs` | TEXT | Observação do admin |
| `criado_por` | VARCHAR | Login do admin que criou |
| `criado_em` | TIMESTAMP | Timestamp automático |
| `ativo` | BOOLEAN | Soft-delete |

> O status (`pendente` / `em_andamento` / `concluida`) é calculado dinamicamente via `SUM(lancamentos.realizado)` após a data de criação da ordem — não é armazenado.

### `lancamentos`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `data` | DATE | Data do apontamento |
| `turno` | VARCHAR | `T1`, `T2` ou `ADM` |
| `ref_cod` | VARCHAR | Referência |
| `descricao` | VARCHAR | Descrição (desnormalizada para histórico) |
| `operador` | VARCHAR | Nome do operador |
| `realizado` | INT | Peças realizadas |
| `meta` | INT | Meta de peças no momento do lançamento |
| `refugo` | INT | Peças refugadas |
| `eficiencia` | NUMERIC(6,4) | Eficiência calculada (0.0 – 1.0+) |
| `hora_inicio` | VARCHAR | Hora de início |
| `hora_fim` | VARCHAR | Hora de fim |
| `obs` | TEXT | Observações |
| `usuario_login` | VARCHAR | Login de quem registrou |
| `criado_em` | TIMESTAMP | Timestamp automático |

### `tarefas`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `usuario_login` | VARCHAR | Dono da tarefa (quem executa) |
| `data` | DATE | Dia agendado — muda a cada adiamento |
| `data_original` | DATE | Primeiro dia agendado (preservado) |
| `titulo` | VARCHAR | O que precisa ser feito |
| `descricao` | TEXT | Detalhes (opcional) |
| `celula` | VARCHAR | Célula vinculada (opcional) |
| `prioridade` | VARCHAR | `baixa`, `media` ou `alta` |
| `status` | VARCHAR | `pendente`, `feita` ou `nao_feita` |
| `obs_status` | TEXT | Motivo do "não feita" |
| `adiamentos` | INT | Quantas vezes já foi adiada |
| `concluida_em` | TIMESTAMP | Quando foi marcada como feita |
| `criado_por` | VARCHAR | Quem criou (admin, quando atribuída) |
| `status_individual` | BOOLEAN | `true` = cada participante marca o seu; `false` = trabalho único |
| `concluida_por` | VARCHAR | Quem fechou (trabalho único) — é quem leva o crédito |
| `ativo` | BOOLEAN | Soft-delete |

> `status`, `obs_status`, `adiamentos` e `concluida_em` em `tarefas` são **legado**: a agenda lê tudo de `tarefa_participantes`. Só `data`, `data_original` e `concluida_por` continuam sendo consultados aqui.

### `tarefa_participantes`

O estado da tarefa **por pessoa**. Existe sempre uma linha por participante, inclusive o responsável — assim a agenda do dia é uma consulta só, igual para tarefa solo e de equipe.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `tarefa_id` | INT | Tarefa |
| `usuario_login` | VARCHAR | Participante |
| `data` | DATE | O dia **dela** — no modo individual cada um adia o seu |
| `status` | VARCHAR | `pendente`, `feita` ou `nao_feita` |
| `obs_status` | TEXT | Motivo do "não feita" |
| `adiamentos` | INT | Adiamentos desta pessoa |
| `concluida_em` | TIMESTAMP | Quando ela concluiu |
| | | `UNIQUE(tarefa_id, usuario_login)` |

> Pendentes com `data` anterior ao dia consultado voltam como **atrasadas** — nada se perde de vista.

### `meta_participantes`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `meta_id` | INT | Meta |
| `usuario_login` | VARCHAR | Participante (o responsável também entra) |
| | | `UNIQUE(meta_id, usuario_login)` |

### `metas_usuario`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `usuario_login` | VARCHAR | Dono da meta |
| `titulo` | VARCHAR | Nome da meta |
| `tipo` | VARCHAR | `tarefas` (progresso automático) ou `numerica` (manual) |
| `periodo` | VARCHAR | `dia`, `semana` ou `mes` |
| `mes_ano` | VARCHAR | Mês de referência (quando `periodo = 'mes'`) |
| `alvo` | NUMERIC(12,2) | Valor a atingir |
| `atual` | NUMERIC(12,2) | Valor atual — só usado no tipo `numerica` |
| `unidade` | VARCHAR | `tarefas`, `%`, `peças`… |
| `celula` | VARCHAR | Conta só tarefas desta célula (opcional) |
| `criado_por` | VARCHAR | Quem criou |
| `ativo` | BOOLEAN | Soft-delete |

> No tipo `tarefas` o progresso **não é armazenado**: é contado na hora a partir das tarefas com `status = 'feita'` no período.

---

## API

Todos os endpoints requerem o header `Authorization: Bearer <token>`, exceto `/api/login`.

### Autenticação

```
POST /api/login
Body: { "login": "user", "senha": "pass" }
Response: { "token": "...", "usuario": { "login", "nome", "perfil" } }
```

### Usuário logado

```
GET /api/me
Response: { "login", "nome", "perfil" }
```

### Referências

```
GET    /api/referencias
POST   /api/referencias
Body:  { "cod": "SP2745LR", "descricao": "...", "celula": "Panos", "meta_hora": 80 }
DELETE /api/referencias
Body:  { "cod": "SP2745LR" }
```

### Programa mensal

```
GET    /api/programa?mes=2026-06&celula=Panos
POST   /api/programa          (admin)
Body:  { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos", "meta_turno": 80, "num_turnos": 2 }
DELETE /api/programa          (admin)
Body:  { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos" }
```

### Lançamentos

```
GET    /api/lancamentos?mes=2026-06&celula=Panos[&turno=T1][&ref=SP2745LR]
POST   /api/lancamentos
Body:  { "data": "2026-06-24", "turno": "T1", "ref_cod": "SP2745LR",
         "operador": "João Silva", "realizado": 80, "meta": 80, "refugo": 0,
         "hora_inicio": "08:00", "hora_fim": "09:00", "obs": "", "eficiencia": 1.0 }
PUT    /api/lancamentos       (admin)
Body:  { "id": 123, "data": "2026-06-24", "turno": "T1", "realizado": 80,
         "refugo": 0, "hora_inicio": "08:00", "hora_fim": "09:00", "obs": "", "eficiencia": 1.0 }
DELETE /api/lancamentos       (admin)
Body:  { "id": 123 }
```

### Dashboard

```
GET /api/dashboard?mes=2026-06[&celula=Panos]
Response: { totais, prog, turnos, recentes }
```

### Operadores

```
GET /api/operadores?mes=2026-06[&celula=Panos]
```

### Ordens de produção

```
GET    /api/ordens
Response: [{ id, celula, ref_cod, quantidade, meta_hora, horas_por_turno,
             data_prevista, obs, criado_por, criado_em, descricao,
             total_realizado, status }]
POST   /api/ordens        (admin)
Body:  { "celula": "Panos", "ref_cod": "SP2745LR", "quantidade": 5000,
         "meta_hora": 80, "horas_por_turno": 8,
         "data_prevista": "2026-07-25", "obs": "Prioridade alta" }
DELETE /api/ordens        (admin)
Body:  { "id": 1 }
```

### Alteração de senha

```
POST /api/senha
# Usuário alterando a própria senha:
Body: { "senha_atual": "atual", "nova_senha": "nova123" }
# Admin redefinindo senha de outro usuário:
Body: { "login": "operador1", "nova_senha": "nova123" }
```

### Colegas (seletor de participantes)

```
GET /api/usuarios?recurso=colegas
Response: [{ "login": "joao", "nome": "João Silva" }, ...]
```

> Liberado para **qualquer usuário logado** — é o que alimenta o seletor de participantes da Agenda. Devolve só login e nome dos ativos, ordenados por nome: sem perfil, sem hash. O CRUD de `/api/usuarios` continua exigindo admin.

### Meses disponíveis

```
GET /api/meses
Response: ["2026-07", "2026-06", ...]
```

> Atendido por `dashboard.mjs?recurso=meses` via *rewrite* no `vercel.json` — veja a nota no fim deste arquivo.

### Agenda (tarefas, metas e gráfico)

Tudo em uma única função (`api/agenda.mjs`), roteada por `?recurso=`.
Operador enxerga e altera **apenas a própria agenda** — o parâmetro `usuario` é ignorado para ele.
Admin pode ler e escrever a agenda de qualquer usuário.

```
# Tarefas do dia (+ pendentes atrasadas de dias anteriores)
GET    /api/agenda?recurso=tarefas&data=2026-09-17[&usuario=joao]
Response: { "data", "tarefas": [...], "atrasadas": [...] }

# Resumo por dia do mês (calendário)
GET    /api/agenda?recurso=tarefas&mes=2026-09[&usuario=joao]
Response: { "dias": [{ "data", "feitas", "nao_feitas", "pendentes" }] }

# Intervalo livre
GET    /api/agenda?recurso=tarefas&de=2026-09-01&ate=2026-09-30[&usuario=joao]

POST   /api/agenda?recurso=tarefas
Body:  { "titulo": "Conferir contagem do CD 03", "data": "2026-09-17",
         "descricao": "", "celula": "Panos", "prioridade": "alta",
         "usuario_login": "joao",          # responsável: só admin define outro
         "participantes": ["maria","pedro"],  # qualquer um pode chamar colegas
         "status_individual": false }      # true = cada um marca o seu

PUT    /api/agenda?recurso=tarefas
Body:  { "id": 1, "status": "feita" }                              # feita | nao_feita | pendente
Body:  { "id": 1, "status": "nao_feita", "obs_status": "faltou material" }
Body:  { "id": 1, "acao": "adiar", "nova_data": "2026-09-18" }     # +1 em adiamentos
Body:  { "id": 1, "titulo": "...", "data": "...", "prioridade": "media", "celula": null,
         "participantes": ["maria"], "status_individual": true }   # edita a equipe

DELETE /api/agenda?recurso=tarefas
Body:  { "id": 1 }
# admin / criador / responsável -> soft-delete da tarefa (para todos)
# participante comum          -> remove só a própria participação ({ saiu: true })
```

```
# Metas com progresso já calculado
GET    /api/agenda?recurso=metas&mes=2026-09&hoje=2026-09-17[&usuario=joao]
# cada meta traz `progresso` (soma) e `por_pessoa`: [{ login, nome, progresso }]

POST   /api/agenda?recurso=metas
Body:  { "titulo": "Concluir 40 tarefas", "tipo": "tarefas", "periodo": "mes",
         "mes_ano": "2026-09", "alvo": 40, "celula": "Panos",
         "participantes": ["maria","pedro"] }   # meta do grupo: progresso somado
Body:  { "titulo": "Reduzir refugo p/ 2%", "tipo": "numerica", "periodo": "mes",
         "mes_ano": "2026-09", "alvo": 2, "atual": 1.2, "unidade": "%" }

PUT    /api/agenda?recurso=metas
Body:  { "id": 1, "atual": 1.8 }        # atualização rápida do progresso manual
DELETE /api/agenda?recurso=metas
Body:  { "id": 1 }
```

```
# Estatísticas do gráfico de atividades
GET /api/agenda?recurso=stats&de=2026-09-01&ate=2026-09-30[&usuario=joao|TODOS][&celula=Panos]
Response: {
  "de", "ate",
  "serie":      [{ "data", "feitas", "nao_feitas", "pendentes" }],
  "resumo":     { "total", "feitas", "feitas_equipe", "nao_feitas", "pendentes",
                  "adiamentos", "compartilhadas" },
  "por_celula": [{ "celula", "feitas", "total" }],
  "equipe":     [{ "usuario_login", "nome", "total", "feitas", ... }]
}
```

> `equipe` só vem preenchido para o admin em modo "toda a equipe" (`usuario=TODOS` ou omitido).

---

## Limite de funções serverless (Vercel Hobby)

O plano Hobby permite **12 funções serverless por deploy**. Por isso alguns handlers acumulam mais de um endpoint, roteados pelo parâmetro **`?recurso=`**:

| Arquivo | Endpoints |
|---------|-----------|
| `usuarios.mjs` | `/api/usuarios` · `?recurso=me` · `?recurso=senha` · `?recurso=colegas` |
| `dashboard.mjs` | `/api/dashboard` · `?recurso=meses` |
| `agenda.mjs` | `?recurso=tarefas` · `?recurso=metas` · `?recurso=stats` |

Os endpoints antigos (`/api/me`, `/api/senha`, `/api/meses`) continuam valendo por **rewrites** no [vercel.json](vercel.json), então o frontend não precisou mudar quando eles foram consolidados. A agenda é nova e chama `?recurso=` direto, sem rewrite.

**Antes de criar um novo arquivo em `api/`, confira a contagem** (`ls api/*.mjs | wc -l`). Perto do teto, acrescente o endpoint a um handler existente por `?recurso=` em vez de criar outro arquivo — ou migre para o plano Pro.
