#!/usr/bin/env node
/* Idades das crianças e trava do POST 2 — v1.6.2.
 *
 *   npm test        (ou: node test/test_idades.js)
 *
 * Caso real (09/11/2026): Tauá Atibaia, www, busca 2 adultos + crianças de 7
 * e 4 (paxs=22&ages=0704). O POST 2 foi com crianças de 2 e 7 e voltou HTTP
 * 500. As fixtures são as da busca idêntica de 08/11 (sem dado pessoal).
 */
'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const { montar, fixture, espera, PESSOAS } = require('./harness');

const www = fixture('www_results_roomselector.json');
const vivo = fixture('tudoazul_roomselector_live.json');
const DADOS_WWW = JSON.parse(www.roomSelectors[0].data);          // [{children:[{age:7},{age:4}]}]
const VIVOS_WWW = {                                                // o widget depois do load
  adults: 2, children: +vivo.step2.childVal, ages: vivo.step2.ageVals.map(Number)
};
const BARRA_WWW = { dados: DADOS_WWW, vivos: VIVOS_WWW };

// padrão salvo: 2 adultos + 2 crianças, de propósito na ordem 4 e 7 (a busca é 7 e 4)
function pessoa(cpf, tipo) {
  const p = PESSOAS[cpf];
  return { type: tipo, doc: cpf, docKind: 'cpf', name: p.Name, surname: p.LastName,
           birthday: p.BirthDate, treatment: tipo === '0' ? 'MR' : 'MSTR', ffp: '' };
}
const PRESET = [pessoa('00000000001', '0'), pessoa('00000000002', '0'),
                pessoa('00000000004', '1'), pessoa('00000000003', '1')];

// arrays que vêm do jsdom são de outro realm: compara pelo valor
const igual = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

function idadesPax(api) { return api.state.paxes.map((p) => p.type + '/' + p.age); }
function criancasEnviadas(bp) {
  return bp[0].paxes.filter((p) => p.paxType !== 0).map((p) => p.paxAge + ':' + p.birthday);
}

// --------------------------------------------------------------- leitura
teste('fixture www: barra e seletor dizem 7 e 4, na ordem da busca', async () => {
  const t = montar({ barras: [BARRA_WWW] });
  const c = t.api.lerComposicaoDaBusca();
  assert.strictEqual(c.fonte, 'barra de busca');
  igual(c.idades, [7, 4]);
  assert.strictEqual(c.conflito, '');
  igual(c.fontes.map((f) => f.nome + '=' + f.idades.join(',')),
                         ['barra de busca=7,4', 'seletor de quartos=7,4']);
  igual(idadesPax(t.api), ['0/30', '0/30', '1/7', '1/4']);
});

teste('plugin do site (roomSelector val) é a fonte do seletor quando existe', async () => {
  const t = montar({ barras: [BARRA_WWW], plugin: () => vivo.step2.val });
  const c = t.api.lerComposicaoDaBusca();
  igual(c.fontes[1].idades, [7, 4]);
  assert.strictEqual(c.conflito, '');
});

teste('URL paxs/ages: 22 + 0704 = 2 adultos, crianças 7 e 4; dois quartos', async () => {
  const t = montar({ barras: [] });
  igual(t.api.fonteUrl('https://x/hotels/results.aspx?paxs=22&ages=0704'),
                         [{ adults: 2, children: [7, 4], babies: [] }]);
  igual(t.api.fonteUrl('https://x/a?paxs=2211&ages=070405'),
                         [{ adults: 2, children: [7, 4], babies: [] }, { adults: 1, children: [5], babies: [] }]);
  assert.strictEqual(t.api.fonteUrl('https://x/a?paxs=22&ages=07'), null);   // contagem não bate
  assert.strictEqual(t.api.fonteUrl('https://x/a?searchSessionID=1'), null);
});

teste('só a URL: idades vêm dela', async () => {
  const t = montar({ barras: [], url: 'https://www.azulviagens.com.br/hotels/results.aspx?searchSessionID=705907#?paxs=22&ages=0704' });
  assert.strictEqual(t.api.state.idadesBusca.fonte, 'URL');
  igual(idadesPax(t.api), ['0/30', '0/30', '1/7', '1/4']);
});

teste('buscador de PACOTE (trip-searcher) com 2 e 7 é ignorado', async () => {
  const pacote = { searcher: 'trip-searcher',
                   dados: [{ adults: [{ age: 30 }, { age: 30 }], children: [{ age: 2 }, { age: 7 }], babies: [] }],
                   vivos: { adults: 2, children: 2, ages: [2, 7] } };
  const t = montar({ barras: [pacote, BARRA_WWW] });
  igual(t.api.state.idadesBusca.idades, [7, 4]);
  assert.strictEqual(t.api.state.idadesBusca.conflito, '');
});

teste('fontes divergem (barra 7,4 x seletor 2,7): idade em branco e o envio é barrado sem POST 1', async () => {
  const t = montar({ barras: [{ dados: DADOS_WWW, vivos: { adults: 2, children: 2, ages: [2, 7] } }], preset: PRESET });
  assert.ok(t.api.state.idadesBusca.conflito.indexOf('seletor de quartos: 2 adulto(s), crianças 2, 7') > -1);
  igual(idadesPax(t.api), ['0/30', '0/30', '1/null', '1/null']);
  assert.ok(t.panel.textContent.indexOf('Não tenho certeza das idades das crianças') > -1);
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0, 'não podia ter feito o POST 1');
  assert.strictEqual(t.post2().length, 0);
  assert.ok(/falta a idade usada na busca/.test(t.log()), t.log());
  // a pessoa informa as idades da busca → libera
  t.digitar(2, 'age', '7');
  t.digitar(3, 'age', '4');
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  igual(t.bookingPaxes()[0].paxes.map((p) => p.paxAge), [30, 30, 7, 4]);
});

// -------------------------------------------------------------- envio ok
teste('caminho feliz: POST 2 com 30,30,7,4 e cada criança com o próprio nascimento', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [7, 4] });
  // o padrão foi salvo como 4,7 — tem que casar pela idade, não pela posição
  igual(t.api.state.paxes.filter((p) => p.type !== '0').map((p) => p.age + ':' + p.birthday),
                         ['7:10/05/2019', '4:03/03/2022']);
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 1);
  assert.strictEqual(t.post2().length, 1, t.log());
  igual(criancasEnviadas(t.bookingPaxes()), ['7:10/05/2019', '4:03/03/2022']);
  assert.ok(/reserva criada/.test(t.log()), t.log());
});

teste('tela de reserva lista as crianças em outra ordem (4,7): dados casam pela idade', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [4, 7] });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, t.log());
  igual(criancasEnviadas(t.bookingPaxes()), ['4:03/03/2022', '7:10/05/2019']);
});

// --------------------------------------------------------- o caso do bug
teste('tela de reserva pede 2 e 7, a busca foi 7 e 4: POST 2 NÃO vai, painel mostra as duas', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [2, 7] });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 1);
  assert.strictEqual(t.post2().length, 0, 'o POST 2 não podia ter saído');
  assert.ok(/crianças de 2, 7 ano\(s\), mas a busca \(barra de busca\) é de 7, 4/.test(t.log()), t.log());
  assert.ok(t.panel.textContent.indexOf('Idades não batem com a tela de reserva do site') > -1);
  // o que a pessoa digitou não foi parar na criança errada
  igual(t.api.state.paxes.filter((p) => p.type !== '0').map((p) => p.age), [7, 4]);
});

teste('consulta de CPF em erro: barra antes do POST 1', async () => {
  const preset = PRESET.map((p) => Object.assign({}, p, { name: '', surname: '', birthday: '' }));
  const t = montar({ barras: [BARRA_WWW], preset, lookup: { '00000000003': 'erro' } });
  await espera(0);
  t.escolher();
  t.clicar('lookup-all');
  await espera(2200);
  const comErro = t.api.state.paxes.filter((p) => p.doc === '00000000003');
  assert.strictEqual(comErro.length, 1);
  assert.strictEqual(comErro[0].status, 'erro');
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0);
  assert.strictEqual(t.post2().length, 0);
  assert.ok(new RegExp(comErro[0].label.replace(/[()]/g, '\\$&') + ': a consulta do CPF falhou').test(t.log()), t.log());
});

teste('consulta de CPF ainda rodando: barra o envio', async () => {
  const preset = PRESET.map((p) => Object.assign({}, p, { name: '', surname: '', birthday: '' }));
  const t = montar({ barras: [BARRA_WWW], preset, lookup: { '00000000001': 'demora' } });
  await espera(0);
  t.escolher();
  t.clicar('lookup-all');
  await espera(50);
  assert.strictEqual(t.api.state.paxes[0].status, '…');
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0);
  assert.ok(/consulta de CPF em andamento/.test(t.log()), t.log());
  await espera(3000);                            // deixa o lookup-all acabar
});

teste('nascimento não bate com a idade da busca (5 x 4): barra, como o formulário do site', async () => {
  const preset = [PRESET[0], PRESET[1], pessoa('00000000003', '1'), pessoa('00000000005', '1')];
  const t = montar({ barras: [BARRA_WWW], preset });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0);
  assert.ok(/Criança 2 \(4 ano\(s\)\): pelo nascimento terá 5 ano\(s\) no check-in \(18\/12\/2026\), mas a busca foi para 4/.test(t.log()), t.log());
});

teste('composição do painel diferente do distribution do motor: barra', async () => {
  const uma = { dados: [{ adults: [{ age: 30 }, { age: 30 }], children: [{ age: 7 }], babies: [] }],
                vivos: { adults: 2, children: 1, ages: [7] } };
  const t = montar({ barras: [uma], preset: PRESET });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0);
  assert.ok(/a busca é para 2 adulto\(s\) e 2 criança\(s\), o painel tem 2 e 1/.test(t.log()), t.log());
});

teste('falta nome/nascimento: barra (antes ia no POST 2 vazio)', async () => {
  const t = montar({ barras: [BARRA_WWW] });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post1().length, 0);
  assert.ok(/Adulto 1: falta o documento/.test(t.log()));
  assert.ok(/Criança 2 \(4 ano\(s\)\): nascimento vazio ou inválido/.test(t.log()));
});

teste('POST 2 com página de erro: mensagem diz o que foi conferido e a causa provável', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post2: 'erro' });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1);
  assert.ok(/Antes de mandar eu conferi: crianças com 7, 4 ano\(s\), iguais às da busca \(barra de busca\)/.test(t.log()), t.log());
  assert.ok(/sessão\/tarifa ter vencido/.test(t.log()));
});

teste('diagnóstico: fontes das idades, o que foi no POST 2 — e nenhum dado pessoal', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [2, 7] });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  t.api.diagnostico();
  const d = t.logs.join('\n');
  assert.ok(d.indexOf('idades da busca: 7, 4 · fonte: barra de busca · barra de busca [2A; 7, 4] · seletor de quartos [2A; 7, 4]') > -1, d);
  assert.ok(d.indexOf('tela de reserva (POST 1): crianças 2, 7') > -1);
  assert.ok(d.indexOf('checagem antes do POST 2: BLOQUEADO') > -1);
  assert.ok(d.indexOf('pax: 4 (Adulto/30/padrão, Adulto/30/padrão, Criança/7/padrão, Criança/4/padrão)') > -1, d);
  Object.keys(PESSOAS).forEach((cpf) => {
    const p = PESSOAS[cpf];
    assert.ok(d.indexOf(cpf) < 0 && d.indexOf(p.LastName) < 0 && d.indexOf(p.BirthDate) < 0, 'dado pessoal no diagnóstico');
  });
});

teste('POST 2 ok registra no diagnóstico só tipo e idade', async () => {
  const t = montar({ barras: [BARRA_WWW], preset: PRESET });
  await espera(0);
  t.escolher();
  await t.api.reservar();
  t.api.diagnostico();
  const d = t.logs.join('\n');
  assert.ok(d.indexOf('POST 2 enviado com: A30,A30,C7,C4') > -1, d);
  assert.ok(d.indexOf('checagem antes do POST 2: ok') > -1, d);
});

// --------------------------------------- reprodução com a v1.6.1 (git)
teste('v1.6.1 (git HEAD~): com a tela de reserva pedindo 2 e 7, o POST 2 saía com 2 e 7', async () => {
  let antigo;
  try {
    antigo = execSync('git show 59b07e0:src/azul_paxes_page2.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  } catch (e) { console.log('   (sem git/commit 59b07e0 — pulei)'); return; }
  const t = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [2, 7], src: antigo });
  assert.strictEqual(t.api.version, '1.6.1');
  await espera(0);
  t.escolher();
  await t.api.reservar();
  assert.strictEqual(t.post2().length, 1, 'na v1.6.1 o POST 2 saía');
  const enviadas = t.bookingPaxes()[0].paxes.filter((p) => p.paxType !== 0);
  // idade da tela de reserva, dados do padrão por POSIÇÃO: a "de 2" levou o nascimento da de 4
  igual(enviadas.map((p) => p.paxAge + ':' + p.birthday), ['2:03/03/2022', '7:10/05/2019']);
});

teste('v1.6.1: reproduz a linha do diagnóstico do Edu (Criança/2/erro, Criança/7/…) e o POST 2 com criança vazia', async () => {
  let antigo;
  try {
    antigo = execSync('git show 59b07e0:src/azul_paxes_page2.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  } catch (e) { console.log('   (sem git/commit 59b07e0 — pulei)'); return; }
  // só documentos no padrão; a consulta da 1ª criança falha e a da 2ª ainda roda
  const preset = PRESET.map((p) => Object.assign({}, p, { name: '', surname: '', birthday: '' }));
  const t = montar({ barras: [BARRA_WWW], preset, post1Idades: [2, 7], post2: 'erro', src: antigo,
                     lookup: { '00000000004': 'erro', '00000000003': 'demora' } });
  await espera(0);
  t.escolher();
  t.clicar('lookup-all');
  await espera(1400);                            // adultos ok, 1ª criança erro, 2ª em andamento
  await t.api.reservar();                        // a pessoa clica em Continuar
  await espera(1500);                            // a consulta pendente termina (no objeto velho)
  assert.strictEqual(t.post2().length, 1);
  const bp = t.bookingPaxes()[0].paxes;
  igual(bp.map((p) => p.paxAge), [30, 30, 2, 7]);
  igual(bp.slice(2).map((p) => [p.name, p.birthday]), [['', ''], ['', '']]);   // crianças sem nome/nascimento
  t.api.diagnostico();
  const d = t.logs.join('\n');
  assert.ok(d.indexOf('pax: 4 (Adulto/30/ok, Adulto/30/ok, Criança/2/erro, Criança/7/…)') > -1, d);
  await espera(1000);
});

teste('build minificado (docs/bookmarklet.js): mesma trava e mesmo envio', async () => {
  const fs = require('fs');
  const f = path.join(__dirname, '..', 'docs', 'bookmarklet.js');
  const src = fs.readFileSync(f, 'utf8');
  const versaoFonte = /var VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'azul_paxes_page2.js'), 'utf8'))[1];
  if (src.indexOf(versaoFonte) < 0) throw new Error('docs/bookmarklet.js não é da v' + versaoFonte + ' — rode npm run build e copie para docs/');
  const ruim = montar({ barras: [BARRA_WWW], preset: PRESET, post1Idades: [2, 7], src });
  await espera(0);
  ruim.escolher();
  await ruim.api.reservar();
  assert.strictEqual(ruim.post2().length, 0);
  const bom = montar({ barras: [BARRA_WWW], preset: PRESET, src });
  await espera(0);
  bom.escolher();
  await bom.api.reservar();
  igual(criancasEnviadas(bom.bookingPaxes()), ['7:10/05/2019', '4:03/03/2022']);
});

(async () => {
  let falhas = 0;
  for (const t of testes) {
    try { await t.fn(); console.log('ok   ' + t.nome); }
    catch (e) { falhas++; console.log('FAIL ' + t.nome + '\n     ' + String(e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
  }
  console.log(`\n${testes.length - falhas}/${testes.length} ok`);
  process.exit(falhas ? 1 : 0);
})();
