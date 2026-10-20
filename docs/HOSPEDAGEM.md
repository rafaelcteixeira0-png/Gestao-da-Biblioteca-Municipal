# Hospedagem do atendimento completo

Preparação para homologação online com dados fictícios. Ainda não há servidor ou domínio de API definidos. Nenhum serviço foi contratado, nenhum dado real foi importado e esta documentação não registra publicação concluída.

## Arquitetura

O frontend pode continuar na Vercel. O navegador chama /api na mesma origem da interface; um rewrite encaminha essas solicitações para a API Node.js 24 em servidor com Docker e HTTPS. O SQLite fica no volume persistente /data desse servidor. Use uma única instância da API: este desenho não oferece banco distribuído ou escalabilidade horizontal e não permite SQLite em disco efêmero de função serverless.

Arquivos de implantação:

- Dockerfile com targets api e proxy, executados sem root.
- deploy/compose.yaml com volumes privados, filesystem somente leitura e rede interna da API.
- deploy/Caddyfile com proxy HTTPS; somente o proxy publica as portas 80 e 443.
- deploy/.env.hosted.example sem credenciais.
- deploy/vercel.example.json como exemplo inativo. Não há rewrite de exemplo ativado na raiz.

O modo hosted exige origem HTTPS explícita, cookies seguros e caminho absoluto do banco. Permite 0.0.0.0 na rede interna do container. O modo local continua restrito a loopback e aceita HTTP. No modo hosted, PORT é alternativa a LIBRARY_PORT; a variável específica tem prioridade.

## Evidências e pendências

A [base operacional validada](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/actions/runs/39438201882) aprovou instalação, formatação, lint, tipos, build, 90 testes do servidor e 34 execuções de navegador. A [validação da hospedagem](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/actions/runs/39444000612) aprovou também os novos casos de configuração (102 testes nativos no total), 34 execuções de navegador e o ensaio de persistência e recuperação em container. Consulte [VALIDACAO_TECNICA.json](VALIDACAO_TECNICA.json) para o resultado registrado.

O teste de container usa dados fictícios e HTTP local: confere o atributo Secure do cookie, permissões, operações da API, persistência após reinício e recuperação isolada. Não comprova emissão real de certificado, DNS ou integração Vercel–API. O ambiente local do Codex está indisponível; os resultados executados são os do CI, quando registrados como aprovados.

Antes de ativar o atendimento online, é necessário definir servidor autorizado com disco persistente, domínio da API, origem HTTPS final do frontend, acessos administrativos e destino externo de backups. Serviço pago, criação de infraestrutura e publicação dependem da aprovação específica do usuário.

## Preparar o servidor autorizado

Os domínios .example são reservados para documentação. Substitua-os pelos domínios autorizados antes de executar a implantação.

Na raiz do checkout revisado:

```bash
cp deploy/.env.hosted.example deploy/.env.hosted
```

Edite o arquivo não versionado:

```dotenv
LIBRARY_ORIGIN=https://biblioteca.example
LIBRARY_API_HOST=api.biblioteca.example
```

LIBRARY_ORIGIN é a origem exata do frontend, e não a da API: somente HTTPS e host, com porta quando necessária, sem credenciais, caminho, consulta ou fragmento. LIBRARY_API_HOST é o domínio público do proxy. As demais variáveis são fornecidas pelo Compose: LIBRARY_MODE=hosted, LIBRARY_HOST=0.0.0.0, LIBRARY_PORT=3001, LIBRARY_DB_PATH=/data/library.sqlite e LIBRARY_COOKIE_SECURE=true. Não coloque senhas ou frases de backup nesse arquivo.

Instale Docker com Compose no servidor e confirme DNS, firewall e portas 80/443. Construa e inicie a API:

```bash
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml build
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml up -d api
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml exec api node server/cli.mjs init
```

A inicialização solicita usuário, nome fictício e senha exclusiva no terminal, sem eco da senha. Não existe senha padrão. Ela cria apenas a administração inicial e recusa repetir essa inicialização sobre uma base com contas existentes.

Depois de apontar o DNS para o servidor autorizado, ative o proxy:

```bash
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml --profile https up -d --build
```

O Caddy usa internamente 8080/8443, mapeados para 80/443 no host. A API não publica porta diretamente. A emissão do certificado depende de DNS e acesso externos reais e não funciona com os domínios fictícios.

Os volumes library_data e library_backups mantêm /data e /backups entre recriações do container. O usuário do container tem UID/GID 1000; diretórios são privados. Não execute docker compose down -v: isso remove os volumes. Conservar volumes no mesmo servidor não substitui backup externo.

## Conectar a Vercel

Após a API HTTPS funcionar e a publicação ser aprovada:

```bash
cp deploy/vercel.example.json vercel.json
```

Revise qualquer configuração existente e substitua https://api.biblioteca.example pelo endereço real da API. Preserve regras necessárias ao projeto. Só então aplique a configuração ao projeto Vercel. O arquivo em deploy sozinho não altera a hospedagem e não deve ser ativado apontando para um domínio fictício.

O frontend permanece usando /api. O encaminhamento deve preservar Origin, Cookie, X-CSRF-Token e Set-Cookie. O cookie é HttpOnly, Secure, SameSite=Strict, sem Domain e restrito a /api. Ao autenticar pelo rewrite, o navegador o associa ao domínio do frontend. Alterações continuam exigindo origem exata e token CSRF; respostas da API usam Cache-Control: no-store.

Não use chamadas diretas do navegador ao domínio externo nem CORS com origem universal para contornar falhas. Uma URL de preview diferente da origem configurada será recusada nas alterações. Para previews operacionais, configure outra instância e outro banco com a origem exata desse ambiente.

Atrás do Caddy, tentativas de login são identificadas pelo IP da conexão com o proxy; usuários podem compartilhar o limite por IP. Confira isso no piloto. Não habilite confiança em X-Forwarded-For arbitrário; uma futura configuração deve aceitar somente proxies explicitamente confiáveis.

## Conferência no ambiente online de testes

Registre data, endereço e resultado de cada etapa:

1. Consultar /api/health pela API HTTPS e pelo frontend. Ambos devem responder JSON com data.status=ok e data.datasetKind=fictional-local, sem HTML da demonstração.
2. Entrar em /#atendimento, recarregar e conferir sessão, atributos do cookie e ausência de cache no navegador.
3. Criar e editar leitor, obra e dois exemplares fictícios; recarregar e conferir persistência.
4. Emprestar dois exemplares, rejeitar novo empréstimo do mesmo exemplar, devolver um item, renovar o outro e conferir todos os eventos no histórico.
5. Conferir acesso permitido e negado para administração, atendente e leitor, além de logout, troca de senha e revogação.
6. Reiniciar a API e conferir registros preservados.
7. Executar backup, restauração isolada e cópia externa.

CI e navegador local não substituem a conferência da cadeia HTTPS, rewrite e cookies do servidor escolhido. Homologação institucional, regras de circulação e teste nos aparelhos físicos da biblioteca permanecem pendentes.

## Backup e recuperação

Use nomes novos em cada ensaio, apenas com registros fictícios:

```bash
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml exec api node server/cli.mjs backup /backups/ensaio-ficticio.backup
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml exec api node server/cli.mjs verify-backup /backups/ensaio-ficticio.backup
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml exec api node server/cli.mjs restore /backups/ensaio-ficticio.backup /backups/ensaio-restaurado.sqlite
```

A CLI pede frase de proteção de pelo menos 16 caracteres, sem eco. O backup usa AES-256-GCM e chave derivada com scrypt. A validação confere integridade, estrutura, relacionamentos, contagens e conteúdo por tabela. A restauração cria outro arquivo, preserva a origem e revoga as sessões da cópia restaurada; recusa destino existente.

O volume separado de backups não protege contra perda do servidor. Exporte o arquivo criptografado:

```bash
mkdir -p backups-ficticios
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml cp api:/backups/ensaio-ficticio.backup ./backups-ficticios/ensaio-ficticio.backup
```

Conserve cópia fora do servidor em destino aprovado e proteja a frase separadamente. Defina frequência, retenção e responsáveis com a biblioteca. Nenhum envio externo ou agendamento foi configurado.

Para ensaiar atendimento a partir do banco restaurado, use outra instância com volume próprio e origem diferente. Compare contagens e histórico, entre com conta existente no backup e confirme que sessões anteriores foram invalidadas. Não execute init sobre o banco restaurado nem substitua o banco ativo para testar.

Recuperação administrativa técnica, restrita a quem possui acesso autorizado ao servidor:

```bash
docker compose --env-file deploy/.env.hosted -f deploy/compose.yaml exec api node server/cli.mjs recover-admin
```

A recuperação redefine a senha e revoga as sessões da conta. Restrinja o acesso administrativo ao servidor e ao arquivo do banco. Estes procedimentos não autorizam migração real ou exclusão de títulos repetidos.
