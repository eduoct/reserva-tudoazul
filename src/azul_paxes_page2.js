/* ---------------------------------------------------------------------------
 * TudoAzul / Azul Viagens — hotéis — passageiros + ida para a tela de cupom
 *
 * USO PRINCIPAL — cole no console da TELA DE RESULTADOS, logado:
 *   1. o painel lê a memória do próprio site ($jbe.results.cache.items) — de
 *      lá saem as tarifas (com pontos/preço), a data de check-in e o
 *      `distribution` da busca, que diz quantos adultos/crianças/bebês
 *      preencher. Sem essa memória, UMA chamada ao results.ashx;
 *      🔴 NUNCA varrer páginas nem pedir hotel por hotel de uma vez: a
 *      proteção do site (Akamai) responde cortando o stream HTTP/2 e derruba
 *      todas as chamadas seguintes da sessão. Tarifas extras de um hotel só
 *      quando a pessoa clica, uma requisição por clique;
 *   2. você escolhe o hotel + a tarifa num dropdown agrupado por hotel;
 *   3. informa os CPFs — ele consulta o cadastro e preenche o que voltar;
 *   4. "Reservar" dispara os dois POSTs em sequência: POST 1 (UID +
 *      optionID) seleciona a tarifa na sessão e devolve o formulário de
 *      passageiros do site; POST 2 (action=book) sai DESSE formulário,
 *      preenchido e serializado como o site faz (getPaxesInfo +
 *      getFormParams), cria a reserva e navega para confirmBooking.aspx,
 *      onde fica o cupom.
 *      Antes de cada um, problemas() confere: idade de cada criança igual à
 *      da busca (lida da barra, do seletor e da URL, conferidas entre si, e
 *      de novo contra a tela de reserva do POST 1), nascimento batendo com
 *      essa idade no check-in (a regra do site), todos os pax completos e
 *      nenhuma consulta de CPF em erro ou rodando. Falhou = não manda.
 *
 * Também funciona se você já estiver na booking.aspx:
 *   - com o formulário de passageiros renderizado → preenche o form real;
 *   - com "Pontos Insuficientes" e sem formulário → mesmo caminho de dois
 *     POSTs, pegando UID/optionID da própria página.
 *
 * Em todos os casos consulta o CPF em /booking/handlers/getHolderInfo.ashx
 * (o mesmo request do link "Validar CPF") e, se não houver cadastro, aceita
 * os dados digitados à mão.
 *
 * NÃO CONFIRMA RESERVA — para na tela de confirmação/cupom.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var VERSION = '1.6.4';
  var KOFI = 'https://ko-fi.com/eduoct';

  // Só monta a UI no site certo. Fora daqui, sai sem tocar na página.
  var HOST_OK = /(^|\.)azulviagens\.com\.br$/i.test(window.location.hostname);
  var PAGE_OK = /\/(results|booking)\.aspx/i.test(window.location.pathname);
  if (!HOST_OK || !PAGE_OK) {
    alert('Reserva TudoAzul v' + VERSION + '\n\n' +
          'Este atalho só funciona na busca de hotéis do TudoAzul / Azul Viagens.\n\n' +
          'Faça a busca, e na TELA DE RESULTADOS (results.aspx), já logado, clique no favorito.');
    return;
  }

  // Opcional: documentos na ordem dos paxes. 🔴 Não commitar preenchido.
  var PRESET_DOCS = [];

  var $ = window.jQuery;
  if (!$) { alert('jQuery não encontrado — está na página do TudoAzul?'); return; }

  var TYPE_LABEL = { '0': 'Adulto', '1': 'Criança', '2': 'Bebê' };
  var LOOKUP_TIMEOUT_MS = 20000;
  var HANDLER = '/booking/handlers/getHolderInfo.ashx';
  var TITLES_ADULT = [{ value: 'MR', text: 'Sr.' }, { value: 'MRS', text: 'Sra.' }];
  var TITLES_CHILD = [{ value: 'MSTR', text: 'Criança (M)' }, { value: 'MISS', text: 'Criança (F)' }];

  // ---------------------------------------------------------------- helpers
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  function maskCPF(s) {
    var d = digits(s);
    return d.length === 11
      ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9)
      : s;
  }

  function parseBR(str) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || '').trim());
    if (!m) return null;
    var d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (isNaN(d)) return null;
    // 31/02/1990 vira 03/03/1990 no construtor do Date. Se não voltar igual,
    // a data não existe — e o site recusaria depois de todo o trabalho.
    if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getFullYear() !== +m[3]) return null;
    return d;
  }

  // ------------------------------------------ data de nascimento digitada
  // O resto do painel só entende dd/mm/aaaa. Quem digita manda de tudo:
  // 01011990, 1/1/1990, 1990-01-31, 01.01.90. Aqui a gente conserta em vez
  // de reclamar "nascimento inválido" na hora de reservar.
  function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

  // ano de 2 dígitos: 81 → 1981, 20 → 2020 (criança). O corte é o ano atual.
  function ano4(y) {
    y = String(y);
    if (y.length === 4) return y;
    var atual = new Date().getFullYear() % 100;
    return (+y <= atual ? '20' : '19') + pad2(y);
  }

  // máscara enquanto digita: só entra quando o texto é exatamente o que a
  // máscara produziria. Se a pessoa digitou as barras dela ("1/1/1990"),
  // ficamos fora do caminho e arrumamos no blur.
  function mascaraData(digitos) {
    var d = String(digitos || '').replace(/\D/g, '').slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
    return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
  }

  function podeMascarar(raw) {
    if (/[^\d/]/.test(raw)) return false;                 // tem '-', '.', letra…
    var pos = [];
    for (var i = 0; i < raw.length; i++) if (raw[i] === '/') pos.push(i);
    return pos.length <= 2 && pos.every(function (p) { return p === 2 || p === 5; });
  }

  function normalizarData(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);          // 1990-01-31
    if (iso) return pad2(iso[3]) + '/' + pad2(iso[2]) + '/' + iso[1];
    var br = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(s);   // 1/1/90
    if (br) return pad2(br[1]) + '/' + pad2(br[2]) + '/' + ano4(br[3]);
    var d = s.replace(/\D/g, '');
    if (d.length === 8) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length === 6) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + ano4(d.slice(4));
    return s;                                              // não reconheci: devolve como veio
  }

  function ageAt(birthStr, refStr) {
    var b = parseBR(birthStr), r = parseBR(refStr);
    if (!b || !r) return null;
    var a = r.getFullYear() - b.getFullYear();
    var pre = r.getMonth() < b.getMonth() ||
              (r.getMonth() === b.getMonth() && r.getDate() < b.getDate());
    return pre ? a - 1 : a;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function brDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  function qsParam(name, href) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(href || window.location.href);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ----------------------------------------------- aviso de cookies do site
  // 🔴 NÃO gravar cookie aqui. A v1.0.6 gravava `accept-cookies` duas vezes
  // (host-only + domain=.azulviagens.com.br). O navegador passou a mandar o
  // par duplicado no header de toda requisição e o site quebrou com
  // ERR_HTTP2_PROTOCOL_ERROR. O ganho era esconder uma tarja; o custo foi o
  // site inteiro. Aqui só desfazemos aquilo e escondemos a tarja na marra.
  function limparCookieDuplicado() {
    var morto = '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    var tinha = (document.cookie.match(/accept-cookies=/g) || []).length;
    if (tinha > 1) {
      try {
        document.cookie = 'accept-cookies' + morto + '; domain=.azulviagens.com.br';
        document.cookie = 'accept-cookies' + morto + '; domain=' + window.location.hostname;
        document.cookie = 'accept-cookies' + morto;
      } catch (e) { /* nada a fazer */ }
    }
    return { tinha: tinha, restou: (document.cookie.match(/accept-cookies=/g) || []).length };
  }

  // O jeito certo é usar o botão do próprio site. O base.min.js faz:
  //   $('.cookie-policy__close').on('click', function () {
  //     Cookies.set('accept-cookies', true, { path: '/', expires: 365 });
  //     $(this).closest('.cookie-policy').fadeOut();
  //   });
  // ou seja: o site JÁ grava por 365 dias. Minha premissa de que ele gravava
  // sem expiração estava errada. Então aqui a gente só dispara o clique dele —
  // e só grava o cookie na mão se o botão não existir (fallback), com a guarda
  // de nunca deixar mais de um `accept-cookies` (foi a duplicata que derrubou
  // o site na v1.0.6).
  // 🔴 O buscador do site exige esse cookie: sem ele, a busca é bloqueada com
  // "you must accept cookies to be able to search" (js_searcher).
  function aceitarPeloSite() {
    var $btn = $('.cookie-policy__close:visible').first();
    if (!$btn.length) $btn = $('.cookie-policy__close').first();

    // sem o botão conhecido, procura um "aceitar/entendi/ok" dentro da tarja.
    // A do OneTrust fica de fora: ela tem caminho próprio (aceitarOneTrust),
    // que roda antes e sabe conferir se o SDK realmente gravou o consentimento.
    if (!$btn.length) {
      acharTarjas().forEach(function (a) {
        if ($btn.length) return;
        if (a.el.id === 'onetrust-banner-sdk' || $(a.el).closest('#onetrust-consent-sdk').length) return;
        $(a.el).find('button, a, [role=button]').each(function () {
          if ($btn.length) return;
          var t = ($(this).text() || '').trim().toLowerCase();
          if (/aceit|concord|entendi|^ok$|prossegu|continuar/.test(t)) $btn = $(this);
        });
      });
    }
    if (!$btn.length) return false;
    state.aceiteClicado = ($btn.attr('class') || $btn.prop('tagName') || '?').toString().slice(0, 60);
    try { $btn.trigger('click'); } catch (e) { return false; }
    return (document.cookie.match(/accept-cookies=/g) || []).length === 1;
  }

  function fixarAceite() {
    function quantos() { return (document.cookie.match(/accept-cookies=/g) || []).length; }
    var antes = quantos();
    if (antes > 1) return { ok: false, motivo: 'já havia duplicata (limpe os cookies do site)' };

    var venc = new Date();
    venc.setFullYear(venc.getFullYear() + 1);
    var attrs = '; path=/; expires=' + venc.toUTCString() + '; SameSite=Lax';
    try { document.cookie = 'accept-cookies=true' + attrs; }
    catch (e) { return { ok: false, motivo: e.message }; }

    var depois = quantos();
    if (depois > 1) {                           // passou de UM: desfaz JÁ
      try { document.cookie = 'accept-cookies=' + attrs.replace(/expires=[^;]+/, 'expires=Thu, 01 Jan 1970 00:00:00 GMT'); }
      catch (e) { /* segue */ }
      return { ok: false, motivo: 'gravar duplicaria o cookie — desfeito' };
    }
    return { ok: quantos() === 1, motivo: '' };
  }

  // ------------------------------------------------------- tarja do OneTrust
  // São DUAS tarjas diferentes neste site, e eu só conhecia uma:
  //   1. a do próprio site  — `.cookie-policy`, cookie `accept-cookies`
  //      (esta o buscador exige; sem ela a busca é bloqueada)
  //   2. a do OneTrust      — `#onetrust-banner-sdk`, cookies `Optanon*`
  // A do OneTrust não tem "cookie"/"consent" no id nem na classe (o id é
  // `onetrust-banner-sdk`, as classes são `otFlat ot-wo-title`...), então o
  // detector antigo nunca a encontrava — era por isso que ela sobrevivia.
  //
  // O botão de aceite é `#onetrust-accept-btn-handler`. Clicamos o botão de
  // verdade: quem grava `OptanonConsent`/`OptanonAlertBoxClosed` é o SDK deles,
  // no formato deles. NÃO escrevemos esses cookies na mão — não sei o formato
  // do OptanonConsent, e cookie de consentimento chutado já derrubou este site
  // uma vez (v1.0.6).
  function nomesDeCookie() {
    return document.cookie.split(';').map(function (c) { return c.trim().split('=')[0]; });
  }

  function temCookieOneTrust() {
    return nomesDeCookie().some(function (n) { return /^OptanonAlertBoxClosed$/i.test(n); });
  }

  function aceitarOneTrust() {
    var banner = document.getElementById('onetrust-banner-sdk');
    if (!banner) return { achou: false };

    var antes = temCookieOneTrust();
    var btn = document.getElementById('onetrust-accept-btn-handler');
    if (!btn) {                                   // id mudou: procura pelo texto
      Array.prototype.slice.call(banner.querySelectorAll('button,a,[role=button]'))
        .forEach(function (b) {
          if (btn) return;
          if (/aceit|concord|entendi|^ok$/i.test((b.textContent || '').trim())) btn = b;
        });
    }
    var clicou = false;
    if (btn) {
      // click() nativo — o handler do OneTrust é addEventListener, não jQuery
      try { btn.click(); clicou = true; } catch (e) { /* segue pro esconder */ }
    }
    return {
      achou: true,
      clicou: clicou,
      botao: btn ? (btn.id || btn.className || btn.tagName) : '(não achei)',
      jaTinha: antes,
      gravou: temCookieOneTrust()
    };
  }

  // esconde a tarja só nesta visualização — sem tocar em cookie nenhum
  // A tarja nem sempre se chama "cookie": pode ser consent, lgpd, privacidade,
  // ou o nome do fornecedor (onetrust/optanon). Além de esconder, guardamos
  // QUAIS elementos casaram, porque quando o aviso volta mesmo com o cookie
  // salvo é sinal de que ele não é o que eu penso.
  var SELETOR_TARJA = '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],' +
                      '[id*="consent" i],[class*="lgpd" i],[id*="lgpd" i],' +
                      '[class*="privacid" i],[id*="privacid" i],' +
                      '[id*="onetrust" i],[class*="onetrust" i],' +
                      '[id*="optanon" i],[class*="optanon" i]';

  function acharTarjas() {
    var achados = [];
    $(SELETOR_TARJA).each(function () {
      var el = this;
      if (panel && (el === panel || $.contains(panel, el))) return;
      // o OneTrust casa em vários filhos (`.ot-sdk-container`, `#onetrust-policy`…);
      // se um ancestral já casou, esconder o filho é ruído no diagnóstico
      var duplicado = achados.some(function (a) { return $.contains(a.el, el); });
      if (duplicado) return;
      var st = window.getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') return;
      if (st.display === 'none' || st.visibility === 'hidden') return;
      achados.push({
        el: el,
        desc: (el.tagName || '?').toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
              ' [' + st.position + ']'
      });
    });
    return achados;
  }

  function esconderTarjaCookies() {
    var achados = acharTarjas();
    state.tarjas = achados.map(function (a) { return a.desc; });
    achados.forEach(function (a) { $(a.el).hide(); });
    return achados.length;
  }

  // ------------------------------------------- padrão de passageiros salvo
  // Guarda os pax que você já usou (localStorage do próprio tudoazul) e
  // repõe automaticamente nas buscas seguintes. São os mesmos dados que o
  // site já tem no cadastro — mas é dado pessoal: use "Limpar padrão" no
  // painel se for usar um navegador que não é seu.
  var PRESET_KEY = 'azulPaxPreset.v1';

  function loadPreset() {
    try { return JSON.parse(window.localStorage.getItem(PRESET_KEY) || 'null') || null; }
    catch (e) { return null; }
  }

  function savePreset() {
    var list = state.paxes
      .filter(function (p) { return p.name || p.doc; })
      .map(function (p) {
        return {
          type: p.type, doc: p.doc, docKind: p.docKind, name: p.name,
          surname: p.surname, birthday: p.birthday, treatment: p.treatment, ffp: p.ffp
        };
      });
    if (!list.length) { log('nada preenchido para salvar.'); return; }
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(list));
      log('✅ padrão salvo: ' + list.map(function (p) { return p.name || p.doc; }).join(', ') +
          '.\nDa próxima vez ele volta sozinho.');
    } catch (e) { log('❌ não consegui salvar: ' + e.message); }
  }

  function clearPreset() {
    try { window.localStorage.removeItem(PRESET_KEY); log('padrão apagado deste navegador.'); }
    catch (e) { log('❌ ' + e.message); }
  }

  // repõe o padrão nas linhas vazias — casa adulto com adulto, criança com criança
  var hydrateInfo = { preset: 0, presetComDoc: 0, aplicados: 0, comDoc: 0 };

  function hydrate(rows) {
    var preset = loadPreset();
    hydrateInfo.preset = preset ? preset.length : 0;
    hydrateInfo.presetComDoc = preset ? preset.filter(function (p) { return !!p.doc; }).length : 0;
    if (!preset || !preset.length) return rows;
    var usados = {};

    rows.forEach(function (p, i) {
      if (p.name || p.doc) return;                       // já preenchido, não mexe
      var alvo = null;
      // criança: 1º a do padrão cujo nascimento dá a idade da busca no check-in.
      // Por posição, a busca "7 e 4" com o padrão salvo como "4 e 7" trocava os
      // dados das duas — e o site recusa criança com nascimento de outra idade.
      var ref = p.tripDate || (state && state.checkin) || '';
      if (p.type !== '0' && ref && p.age != null && !isNaN(p.age)) {
        for (var k = 0; k < preset.length; k++) {
          if (!usados[k] && String(preset[k].type) === String(p.type) &&
              ageAt(normalizarData(preset[k].birthday), ref) === +p.age) { alvo = k; break; }
        }
      }
      // depois a mesma posição, se o tipo bater
      if (alvo === null && preset[i] && !usados[i] && String(preset[i].type) === String(p.type)) alvo = i;
      // senão, o primeiro do mesmo tipo ainda não usado
      if (alvo === null) {
        for (var j = 0; j < preset.length; j++) {
          if (!usados[j] && String(preset[j].type) === String(p.type)) { alvo = j; break; }
        }
      }
      if (alvo === null) return;
      usados[alvo] = true;
      var src = preset[alvo];
      p.doc = src.doc || ''; p.docKind = src.docKind || 'cpf';
      p.name = src.name || ''; p.surname = src.surname || '';
      p.birthday = src.birthday || ''; p.ffp = src.ffp || '';
      if (src.treatment && p.titles.some(function (t) { return t.value === src.treatment; })) {
        p.treatment = src.treatment;
      }
      p.comId = digits(p.doc);
      p.status = 'padrão';
      hydrateInfo.aplicados++;
      if (p.doc) hydrateInfo.comDoc++;
    });
    return rows;
  }

  // Idade da criança informada depois (fontes divergiam): o padrão tinha sido
  // posto por posição. Com todas as idades conhecidas, refaz só as crianças
  // vindas do padrão, agora casando pelo nascimento. Devolve true se mexeu.
  function recasarCriancasDoPadrao() {
    var kids = state.paxes.filter(function (p) { return p.type !== '0' && p.status === 'padrão'; });
    if (!kids.length) return false;
    if (state.paxes.some(function (p) { return p.type !== '0' && idadeOuNull(p.age) === null; })) return false;
    var antes = kids.map(function (p) { return p.doc; }).join('|');
    kids.forEach(function (p) {
      p.doc = p.name = p.surname = p.birthday = p.ffp = p.comId = '';
      p.status = 'pendente';
    });
    var aplicados = hydrateInfo.aplicados, comDoc = hydrateInfo.comDoc;
    hydrate(state.paxes);
    hydrateInfo.aplicados = aplicados; hydrateInfo.comDoc = comDoc;
    return kids.map(function (p) { return p.doc; }).join('|') !== antes;
  }

  // o que o padrão fez — em texto, pra não ter que adivinhar
  function resumoPreset() {
    if (!hydrateInfo.preset) return 'nenhum padrão salvo neste navegador.';
    return 'padrão: ' + hydrateInfo.preset + ' pax salvos (' + hydrateInfo.presetComDoc +
           ' com documento) · aplicados agora: ' + hydrateInfo.aplicados +
           ' (' + hydrateInfo.comDoc + ' com documento)' +
           (hydrateInfo.preset && !hydrateInfo.aplicados
             ? '\n⚠️ nada foi aplicado — o tipo dos pax salvos não bate com o da busca atual.'
             : '');
  }

  // ------------------------------------------------------- modelo de pax
  function newPax(o) {
    return $.extend({
      $row: null, room: 1, type: '0', typeLabel: 'Adulto', age: 30,
      tripDate: '', adultAgeFrom: 18, label: '', titles: TITLES_ADULT,
      ageIncerta: false,
      doc: '', docKind: 'cpf', name: '', surname: '', birthday: '',
      treatment: '', ffp: '', comId: '', cpfFromFFP: '', status: 'pendente',
      // do formulário do site (POST 1 ou a booking.aspx aberta):
      //   rowIndex — posição da linha; campos — nomes dos campos da linha;
      //   extras — campos obrigatórios que o painel não cobre (ex.: pax-gender);
      //   extra — o que a pessoa escolheu neles; info — o que a consulta do CPF devolveu
      rowIndex: null, campos: null, extras: [], extra: {}, info: null, selectsPadrao: {}, tiposDoc: null
    }, o);
  }

  // ------------------------------------------------ formulário do site
  // Campos da linha de passageiro que o painel preenche sozinho. O que não está
  // aqui fica com o que o formulário do site trouxe — inclusive o padrão de cada
  // <select> (tipo de documento, nacionalidade…), linha por linha.
  var CAMPOS_DO_PAINEL = ['comId', 'pax-idTDC', 'pax-document-number', 'pax-tipo-socio',
    'pax-numero-socio', 'pax-treatment', 'pax-name', 'pax-surname', 'pax-birthday'];
  // o próprio JS do site preenche estes a partir do tipo de documento (ver efeitoDoTipoDeDocumento)
  var SEL_CAMPOS_DO_TIPO_DOC = '.js-pax-document-expedition, .js-pax-passport-expiration';

  // "escondido pelo site": dentro de .hidden/.invisible ou display:none — menos a
  // linha de campos extras, que o site mostra depois da consulta do CPF
  function escondidoPeloSite(el, $row) {
    var n = el.parentNode;
    while (n && n !== $row[0]) {
      var cls = ' ' + (n.className || '') + ' ';
      var extraRow = cls.indexOf(' booking-paxes__pax-fields-row--extra-fields ') > -1;
      if (!extraRow && (/ (hidden|invisible) /.test(cls) ||
          /display\s*:\s*none/i.test(n.getAttribute && n.getAttribute('style') || ''))) return true;
      n = n.parentNode;
    }
    return false;
  }

  function rotuloDoCampo($el) {
    var t = $el.closest('label').find('.booking-paxes__pax-field-label, .js-booking-paxes__pax-field-label').first().text() ||
            $el.attr('placeholder') || $el.attr('name') || '';
    return String(t).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }

  // o que a linha do formulário tem, sem valor digitado nenhum: nomes dos campos,
  // padrão de cada <select> e os obrigatórios que o painel não sabe preencher
  function lerCamposDaLinha($row) {
    var campos = [], extras = [], selects = {}, tiposDoc = null;
    $row.find(':input[name]').each(function () {
      var $e = $(this), nome = this.name;
      if (campos.indexOf(nome) < 0) campos.push(nome);
      if ($e.is('select')) selects[nome] = $e.val();
      if (nome === 'pax-idTDC' && !tiposDoc) {
        tiposDoc = $e.find('option').map(function () { return this.value; }).get();
      }
      if (CAMPOS_DO_PAINEL.indexOf(nome) > -1 || this.type === 'hidden' || this.disabled) return;
      if ($e.closest(SEL_CAMPOS_DO_TIPO_DOC).length) return;
      if (!$e.is('[required]') || escondidoPeloSite(this, $row)) return;
      if (extras.some(function (x) { return x.name === nome; })) return;
      extras.push({
        name: nome, label: rotuloDoCampo($e) || nome,
        tag: $e.is('select') ? 'select' : 'input',
        options: $e.is('select') ? $e.find('option').map(function () {
          return { value: this.value, text: $(this).text().trim() };
        }).get() : null,
        padrao: $e.val() || ''
      });
    });
    return { campos: campos, extras: extras, selects: selects, tiposDoc: tiposDoc };
  }

  // o formulário do POST 1 em texto, para o 🩺: só nomes de campo, opções e
  // padrões dos <select> que não são dado de ninguém. Nada digitado.
  var SELECTS_NO_DIAG = ['pax-idTDC', 'pax-document-type', 'pax-tipo-socio', 'pax-nationality',
    'pax-residence-country', 'pax-passport-country', 'pax-gender', 'pax-treatment'];
  function descreverFormulario(rows, doc) {
    var linhas = rows.map(function (p) {
      var sel = SELECTS_NO_DIAG.filter(function (n) { return p.selectsPadrao && n in p.selectsPadrao; })
        .map(function (n) {
          var v = p.selectsPadrao[n];
          return n.replace(/^pax-/, '') + '=' + (v == null ? '∅' : v === '' ? '""' : v) +
                 (n === 'pax-idTDC' && p.tiposDoc ? '(' + p.tiposDoc.join('/') + ')' : '');
        });
      return (p.type === '0' ? 'A' : 'C') + (isNaN(p.age) ? '?' : p.age) + '[' +
        (p.campos || []).map(function (n) { return n.replace(/^pax-/, ''); }).join(',') +
        (sel.length ? ' · ' + sel.join(' ') : '') +
        (p.extras && p.extras.length ? ' · obrigatórios extras: ' + p.extras.map(function (x) { return x.name; }).join(',') : '') +
        ']';
    });
    var $bd = $(doc).find('.booking-data').first();
    var escondidos = $bd.find('.booking-data__hidden-fields').map(function () {
      return this.name || ('<' + this.tagName.toLowerCase() + '>');
    }).get();
    return linhas.join(' ') + ' · hidden-fields: ' + (escondidos.join(',') || '(nenhum)') +
      ' · notes: ' + ($bd.find('[name=notes]').length ? 'sim' : 'não') +
      ' · slider de pontos: ' + ($(doc).find('.points-slider__points-amount').length ? 'sim' : 'não');
  }

  // o que foi no POST 2, sem valor pessoal: chaves, tipo de documento, forma do comId
  function resumoDoEnvio(params) {
    var bp = [];
    try { bp = JSON.parse(params.bookingPaxes); } catch (e) { return '(não li o bookingPaxes)'; }
    var paxes = bp.map(function (r) {
      return r.paxes.map(function (p) {
        var chaves = Object.keys(p).filter(function (k) {
          return p[k] !== '' && p[k] !== null && p[k] !== false && k !== 'paxType' && k !== 'paxAge' &&
                 !(k === 'numberOfBags' && p[k] === 0);
        });
        return (p.paxType === 0 ? 'A' : 'C') + p.paxAge + '{' + chaves.map(function (k) {
          return k === 'idTDC' || k === 'documentType' ? k + '=' + p[k] : k;
        }).join(',') + '}';
      }).join(' ');
    }).join(' | ');
    var com = params.comId == null ? 'sem comId' : 'comId ' + String(params.comId).split(',').length +
      ' posição(ões), ' + String(params.comId).split(',').filter(Boolean).length + ' preenchida(s)';
    return 'campos: ' + Object.keys(params).join(',') + ' · ' + com + ' · paxes: ' + paxes;
  }

  // lê as linhas de pax de um documento (a página atual ou o HTML do POST 1)
  function readPaxRows(root, live) {
    var $root = $(root);
    var rows = $root.find('.js-booking-paxes-pax-row');
    return rows.map(function (i, el) {
      var $row = $(el);
      var type = String($row.attr('data-pax-type'));
      var titles = $row.find('[name=pax-treatment] option').map(function () {
        return { value: this.value, text: $(this).text().trim() };
      }).get();
      var lidos = lerCamposDaLinha($row);
      return newPax({
        $row: live ? $row : null,
        rowIndex: i,
        campos: lidos.campos,
        extras: lidos.extras,
        selectsPadrao: lidos.selects,
        tiposDoc: lidos.tiposDoc,
        room: $row.closest('.booking-paxes__room').attr('data-roomnumber') || 1,
        type: type,
        typeLabel: TYPE_LABEL[type] || 'Pax',
        age: parseInt($row.attr('data-pax-age'), 10),
        tripDate: $row.attr('data-pax-tripdate') || '',
        adultAgeFrom: parseInt($row.attr('data-pax-adultagefrom'), 10) || 18,
        label: $row.find('.booking-paxes__pax-type').text().replace(/\s+/g, ' ').trim(),
        titles: titles.length ? titles : (type === '0' ? TITLES_ADULT : TITLES_CHILD),
        treatment: (titles[0] || {}).value || (type === '0' ? 'MR' : 'MSTR')
      });
    }).get();
  }

  // ----------------------------------------- composição e idades da busca
  // 🔴 A idade de cada criança tem que ser EXATAMENTE a da busca, na ordem da
  // busca. O motor cotou a tarifa para essas idades; outra idade no POST 2 é
  // HTTP 500 (v1.6.1, 09/11/2026: busca com 7 e 4, o POST 2 foi com 2 e 7).
  // Por isso a idade sai de mais de uma fonte, e as fontes são conferidas:
  //   1. barra   — `data-room-selector-data` do buscador de HOTÉIS: o JSON que o
  //                servidor renderiza para ESTA busca: [{children:[{age:7},{age:4}]}]
  //   2. seletor — o que o seletor de quartos do site tem agora. Primeiro pelo
  //                próprio plugin ($(el).roomSelector('val'), o mesmo leitor que o
  //                site usa para montar `paxs=22&ages=0704`); sem ele, os <select>
  //                lidos do mesmo jeito que o roomSelector.load do site os preenche
  //   3. URL     — `paxs` + `ages`, quando estiverem na URL
  // A contagem ainda é conferida com o `distribution` do motor (problemas()).
  // Divergiu? Ninguém chuta: a idade fica em branco e o painel pede.
  // 🔴 O buscador de PACOTE (trip-searcher, aéreo + hotel) é outra busca, com
  // criança a partir de 2 anos — nunca serve de fonte aqui.

  function idadeOuNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  // [{adults:[..], children:[{age}], babies:[{age}]}] → [{adults:n, children:[idades], babies:[idades]}]
  function normalizarQuartos(j) {
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { return null; } }
    if (!Array.isArray(j) || !j.length) return null;          // o plugin pode devolver o próprio jQuery
    var out = j.map(function (r) {
      r = r || {};
      function idades(l) { return (l || []).map(function (p) { return idadeOuNull(p && p.age); }); }
      return { adults: (r.adults || []).length, children: idades(r.children), babies: idades(r.babies) };
    });
    return out.some(function (r) { return r.adults; }) ? out : null;
  }

  // idades dos não-adultos na ordem em que os pax são montados: por quarto,
  // crianças e depois bebês — a mesma ordem do `ages=` do encoder do site
  function idadesNaoAdultos(quartos) {
    var out = [];
    (quartos || []).forEach(function (r) { out = out.concat(r.children || [], r.babies || []); });
    return out;
  }

  function totalAdultos(quartos) {
    return (quartos || []).reduce(function (n, r) { return n + (r.adults || 0); }, 0);
  }

  function mesmaLista(a, b) {
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }

  function mesmoConjunto(a, b) {
    function ord(l) { return l.slice().sort(function (x, y) { return x - y; }); }
    return mesmaLista(ord(a), ord(b));
  }

  function txtIdades(l) {
    if (!l || !l.length) return 'nenhuma';
    return l.map(function (x) { return x == null || isNaN(x) ? '?' : x; }).join(', ');
  }

  // os seletores de quarto da página que são do buscador de HOTÉIS
  function seletoresDeQuarto() {
    var hotel = [], outros = [];
    $('.room-selector').each(function () {
      if (typeof panel !== 'undefined' && panel && $.contains(panel, this)) return;
      var $el = $(this);
      var ids = [$el.attr('id'), $el.find('[id]').first().attr('id'), $el.closest('[id]').attr('id')]
        .join(' ');
      if (/hotel-searcher/i.test(ids)) { hotel.push(this); return; }
      if (/trip-searcher|package|pacote/i.test(ids)) return;      // busca de pacote: outra busca
      outros.push(this);
    });
    return hotel.length ? hotel : outros;
  }

  function fonteBarra(els) {
    var achados = [];
    els.forEach(function (el) {
      var raw = $(el).attr('data-room-selector-data');
      if (!raw) return;
      try {
        var q = normalizarQuartos(JSON.parse(raw));
        if (q) achados.push(q);
      } catch (e) { /* JSON quebrado: fica de fora */ }
    });
    return achados;
  }

  function fonteSeletor(el) {
    var $el = $(el);
    if ($.fn.roomSelector) {
      try {
        var q = normalizarQuartos($el.roomSelector('val'));
        if (q) return q;
      } catch (e) { /* plugin com outra API: lê os <select> */ }
    }
    var $box = $el.find('.room-selector-box');
    if (!$box.length) $box = $el;
    var $rooms = $box.find('.room');
    if (!$rooms.length) return null;
    var nRooms = parseInt($box.find('.nrooms').val(), 10) || 1;
    function idades($sel, n) {
      var out = [];
      for (var i = 0; i < n; i++) out.push(i < $sel.length ? idadeOuNull($sel.eq(i).val()) : null);
      return out;
    }
    var out = [];
    $rooms.slice(0, nRooms).each(function () {
      var $r = $(this);
      var nA = parseInt($r.find('.js-adults-selector').val(), 10) || 0;
      var nC = parseInt($r.find('.js-children-selector').val(), 10) || 0;
      var nB = parseInt($r.find('.js-babies-selector').val(), 10) || 0;
      var $ca = $r.find('.js-children-ages .age');
      if (!$ca.length) $ca = $r.find('select.age[data-pax-type-label=children]');
      var $ba = $r.find('.js-babies-ages .age');
      if (!$ba.length) $ba = $r.find('select.age[data-pax-type-label=babies]');
      out.push({ adults: nA, children: idades($ca, nC), babies: idades($ba, nB) });
    });
    return out.some(function (r) { return r.adults; }) ? out : null;
  }

  // paxs = por quarto hex(adultos) + hex(crianças+bebês); ages = 2 dígitos por
  // criança, na ordem. Ex.: 2 adultos + 7 e 4 → paxs=22&ages=0704
  function fonteUrl(href) {
    href = href || window.location.href;
    var mP = /[?&#]paxs=([0-9a-fA-F]+)(?=[&#]|$)/.exec(href);
    if (!mP || mP[1].length % 2) return null;            // "A-C" (>15 num quarto): não arrisco
    var mA = /[?&#]ages=(\d*)/.exec(href);
    var idades = mA && mA[1] ? (mA[1].match(/\d{2}/g) || []).map(Number) : [];
    var quartos = [];
    for (var i = 0; i < mP[1].length; i += 2) {
      quartos.push({ adults: parseInt(mP[1][i], 16), n: parseInt(mP[1][i + 1], 16) });
    }
    var total = quartos.reduce(function (s, q) { return s + q.n; }, 0);
    if (idades.length !== total) return null;
    var k = 0;
    var out = quartos.map(function (q) {
      var c = idades.slice(k, k + q.n); k += q.n;
      return { adults: q.adults, children: c, babies: [] };
    });
    return out.some(function (r) { return r.adults; }) ? out : null;
  }

  // junta as fontes: a primeira que existir manda, as outras conferem
  function lerComposicaoDaBusca(href) {
    var els = seletoresDeQuarto();
    var fontes = [];
    fonteBarra(els).forEach(function (q, i) {
      fontes.push({ nome: 'barra de busca' + (i ? ' #' + (i + 1) : ''), quartos: q });
    });
    var s = els.length ? fonteSeletor(els[0]) : null;
    if (s) fontes.push({ nome: 'seletor de quartos', quartos: s });
    var u = fonteUrl(href);
    if (u) fontes.push({ nome: 'URL', quartos: u });
    if (!fontes.length) return null;

    var base = fontes[0], idBase = idadesNaoAdultos(base.quartos);
    var divergem = fontes.slice(1).some(function (f) {
      return !mesmaLista(idadesNaoAdultos(f.quartos), idBase) ||
             totalAdultos(f.quartos) !== totalAdultos(base.quartos);
    });
    var semIdade = idBase.some(function (a) { return a === null; });
    return {
      quartos: base.quartos,
      fonte: base.nome,
      idades: idBase,
      fontes: fontes.map(function (f) {
        return { nome: f.nome, adultos: totalAdultos(f.quartos), idades: idadesNaoAdultos(f.quartos) };
      }),
      conflito: divergem || semIdade
        ? fontes.map(function (f) {
            return f.nome + ': ' + totalAdultos(f.quartos) + ' adulto(s), crianças ' +
                   txtIdades(idadesNaoAdultos(f.quartos));
          }).join(' · ')
        : ''
    };
  }

  // monta os pax da composição da busca. Com conflito, a idade das crianças
  // fica em branco (ageIncerta) e o painel pede.
  function readSearchBarPaxes() {
    var comp = lerComposicaoDaBusca();
    state.idadesBusca = comp;
    var raw = comp ? comp.quartos : null;

    // último recurso: o resumo textual ("1 Quartos 2 adulto(s) 2 criança(s)").
    // Ele só CONTA — a idade fica em branco, nunca um 5 de chute.
    if (!raw) {
      var txt = $('.search-summary__paxes').first().text().replace(/\s+/g, ' ');
      var mA = /(\d+)\s*adulto/i.exec(txt), mC = /(\d+)\s*(criança|crianc|child)/i.exec(txt);
      if (mA) {
        raw = [{
          adults: +mA[1],
          children: Array.apply(null, Array(mC ? +mC[1] : 0)).map(function () { return null; }),
          babies: []
        }];
      }
    }

    if (!raw) return [];

    var conflito = !!(comp && comp.conflito);
    var out = [];
    raw.forEach(function (room, ri) {
      var n = ri + 1;
      var sufixo = raw.length > 1 ? ' · quarto ' + n : '';
      for (var a = 0; a < room.adults; a++) {
        out.push(newPax({
          room: n, type: '0', typeLabel: TYPE_LABEL['0'], age: 30,
          titles: TITLES_ADULT, treatment: 'MR', label: TYPE_LABEL['0'] + ' ' + (a + 1) + sufixo
        }));
      }
      function push(list, type) {
        (list || []).forEach(function (age, i) {
          if (conflito) age = null;
          out.push(newPax({
            room: n, type: type, typeLabel: TYPE_LABEL[type], age: age,
            ageIncerta: age === null,
            titles: TITLES_CHILD, treatment: 'MSTR',
            label: TYPE_LABEL[type] + ' ' + (i + 1) +
                   (age === null ? '' : ' (' + age + ' ano(s))') + sufixo
          }));
        });
      }
      push(room.children, '1');
      push(room.babies, '2');
    });
    return hydrate(out);
  }

  // traz o que já foi digitado para as linhas que o servidor devolveu.
  // 🔴 Casa por tipo + idade, não por posição: a tela de reserva pode listar as
  // crianças em outra ordem, e por posição os dados da de 7 iam para a de 4.
  function mergeTyped(serverRows, typed) {
    var usados = {};
    function par(p, i) {
      var j, t;
      for (j = 0; j < typed.length; j++) {
        t = typed[j];
        if (usados[j] || String(t.type) !== String(p.type)) continue;
        if (p.type === '0' || (t.age != null && +t.age === +p.age)) return j;
      }
      // idade desconhecida no painel: mesma posição, se o tipo bater
      t = typed[i];
      if (t && !usados[i] && String(t.type) === String(p.type) && (t.age == null || isNaN(t.age))) return i;
      return -1;
    }
    serverRows.forEach(function (p, i) {
      var j = par(p, i);
      if (j < 0) return;
      usados[j] = true;
      var t = typed[j];
      ['doc', 'docKind', 'name', 'surname', 'birthday', 'ffp', 'comId', 'cpfFromFFP', 'status', 'info']
        .forEach(function (k) { if (t[k]) p[k] = t[k]; });
      if (t.treatment && p.titles.some(function (x) { return x.value === t.treatment; })) {
        p.treatment = t.treatment;
      }
      // o que a pessoa escolheu nos campos extras volta, se a linha nova ainda tem o campo
      Object.keys(t.extra || {}).forEach(function (k) {
        var x = p.extras.filter(function (e) { return e.name === k; })[0];
        if (!x) return;
        if (x.options && !x.options.some(function (o) { return o.value === t.extra[k]; })) return;
        p.extra[k] = t.extra[k];
      });
    });
    return serverRows;
  }

  // --------------------------------------------- consulta do titular (CPF)
  async function lookup(pax) {
    var id = digits(pax.doc);
    if (!id) throw new Error('documento vazio');

    // sem tempo-limite, uma consulta presa deixava o pax em "…" para sempre —
    // e o painel seguia para o POST 2 com ele pela metade
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, LOOKUP_TIMEOUT_MS) : null;
    var res, txt, data;
    try {
      res = await fetch(HANDLER + '?_=' + Date.now() + '&id=' + encodeURIComponent(id), {
        credentials: 'same-origin',
        signal: ctl ? ctl.signal : undefined,
        headers: {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'x-requested-with': 'XMLHttpRequest'
        }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      txt = await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('a consulta passou de ' + (LOOKUP_TIMEOUT_MS / 1000) + ' s sem resposta');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }

    try { data = JSON.parse(txt); }
    catch (e) { throw new Error('resposta não-JSON (sessão caiu ou Akamai barrou)'); }

    if (!data || data.ErrorData || !data.Name) throw new Error('sem cadastro');
    return data;
  }

  // ------------------------------------------- refs da tarifa (UID/optionID)
  function detectRefs() {
    var d = window.$jbe && $jbe.booking1 && $jbe.booking1.options && $jbe.booking1.options.data;
    if (d && d.UID && d.optionID) return { UID: d.UID, optionID: d.optionID, from: '$jbe.booking1' };

    var m = /"UID"\s*:\s*"([^"]+)"[\s\S]{0,400}?"optionID"\s*:\s*"([^"]+)"/
      .exec(document.documentElement.innerHTML);
    if (m) return { UID: m[1], optionID: m[2], from: 'script inline' };

    return null;
  }

  // Catálogo vindo do results.ashx — mesma fonte do v3. Traz optionID, pontos,
  // preço, a data de check-in e o `distribution` (a composição real da busca).
  function catalogoDoResultado(res) {
    var h = res.hotel || {}, av = res.availability || {};
    return (av.options || []).map(function (o) {
      var red = o.priceDetail && o.priceDetail.LoyaltyRules &&
                o.priceDetail.LoyaltyRules.redemption;
      var c = {
        hotel: h.name,
        uid: h.UID || (h.GUID || '').replace('HOT:', ''),
        optionID: o.ID,
        quarto: (o.roomList && o.roomList[0] ? o.roomList[0].name : '') || 'opção',
        pensao: o.boardTypeName || o.boardCode || '',
        preco: o.price,
        moeda: o.currency,
        pontos: red ? red.points.pointsTotalAmount : null,
        semReemb: !!o.nonRefundable,
        dist: av.distribution,
        checkin: av.startDate
      };
      c.label = c.quarto + (c.pensao ? ' · ' + c.pensao : '') + ' · ' +
                (c.pontos != null ? c.pontos.toLocaleString('pt-BR') + ' pts'
                                  : c.moeda + ' ' + c.preco) +
                (c.semReemb ? ' · sem reemb.' : '');
      return c;
    });
  }

  // 🔴 A PROTEÇÃO DO SITE (Akamai) CORTA A CONEXÃO — não responde 403, ela
  // mata o stream HTTP/2 (ERR_HTTP2_PROTOCOL_ERROR no console). Foi o que
  // aconteceu na v1.4.x: eu varria todas as páginas do results.ashx e depois
  // disparava um POST por hotel, ~30 requisições em 6 s. Nenhum humano faz
  // isso, e depois do estouro TODA chamada da sessão passa a ser cortada.
  //
  // Então, na ordem:
  //   1. ler a memória do PRÓPRIO site ($jbe.results.cache.items) — 0 requisições
  //   2. se não houver, UMA chamada ao results.ashx, com os mesmos parâmetros
  //      que o site manda, pelo mesmo jQuery que ele usa
  //   3. tarifas extras de um hotel: só quando VOCÊ escolhe o hotel, 1 POST
  //
  // Qualquer falha de rede acende `state.bloqueado` e o painel para de pedir.
  function siteResults() {
    var r = window.$jbe && window.$jbe.results;
    return (r && r.options && r.options.searchInfo) ? r : null;
  }

  function sidDaPagina() {
    var r = siteResults();
    if (r && r.options.searchInfo.searchSessionID) return String(r.options.searchInfo.searchSessionID);
    return qsParam('searchSessionID') ||
           (/searchSessionID=(\d+)/.exec(window.location.hash) || [])[1] || '';
  }

  // já tem todas as tarifas deste hotel? o próprio site sabe: `hasAllOptions`
  // na config, `hasUpdatedOptions` no item (o "+" já foi clicado) ou
  // `moreOptions: false` na disponibilidade (não existe mais nada).
  function hotelJaCompleto(uid) {
    var r = siteResults();
    if (!r) return false;
    if (r.options.config && r.options.config.hasAllOptions) return true;
    var it = r.cache && r.cache.items && r.cache.items[uid];
    if (!it) return false;
    if (it.hasUpdatedOptions) return true;
    return !!(it.availability && it.availability.moreOptions === false);
  }

  // parâmetros extra que o site sempre manda junto (filtros e extraParams)
  function paramsDoSite() {
    var r = siteResults();
    var p = { searchSessionID: sidDaPagina() };
    if (window.$jbe && window.$jbe.currency) p.currency = window.$jbe.currency;
    if (r) {
      $.extend(p, r.filters || {}, (r.options.searchInfo.extraParams) || {});
    }
    return p;
  }

  // (1) a memória do site: cache.items é um mapa UID -> { hotel, availability },
  // preenchido conforme a lista é renderizada. Custo zero.
  function catalogoDoCacheDoSite() {
    var r = siteResults();
    var itens = r && r.cache && r.cache.items;
    if (!itens) return null;
    var cat = [];
    Object.keys(itens).forEach(function (uid) {
      var it = itens[uid];
      if (it && it.availability) cat = cat.concat(catalogoDoResultado(it));
    });
    return cat.length ? cat : null;
  }

  // (2) UMA página do results.ashx, no formato exato do site:
  //     $.getJSON(handlers.results, { searchSessionID, currency, ...filtros })
  function pedirResults() {
    var sid = sidDaPagina();
    if (!sid) return Promise.resolve(null);
    return new Promise(function (resolve) {
      $.getJSON('/hotels/ashx/results.ashx', paramsDoSite())
        .done(function (j) { resolve(j && j.results ? j : null); })
        .fail(function (xhr) {
          // status 0 = stream cortado antes da resposta (a proteção agindo)
          if (!xhr || !xhr.status) marcarBloqueio('results.ashx');
          resolve(null);
        });
    });
  }

  function marcarBloqueio(onde) {
    if (state.bloqueado) return;
    state.bloqueado = onde;
    log('⛔ A proteção do site cortou a conexão em ' + onde + ' ' +
        '(no console aparece ERR_HTTP2_PROTOCOL_ERROR).\n' +
        'Não vou insistir — insistir só piora. Recarregue a página (F5) para o ' +
        'site revalidar a sessão; o painel segue funcionando com as tarifas que ' +
        'já estão na tela.');
    render();
  }

  async function loadCatalog() {
    var doCache = catalogoDoCacheDoSite();
    if (doCache) { state.catalogFonte = 'memória do site'; return doCache; }

    var json = await pedirResults();
    if (!json) return null;
    state.catalogFonte = 'results.ashx';
    var sum = json.summary || {};
    state.hoteisTotal = parseInt(sum.totalResults, 10) || json.results.length;
    var cat = [];
    json.results.forEach(function (res) { cat = cat.concat(catalogoDoResultado(res)); });
    return cat.length ? cat : null;
  }

  // (3) O results.ashx devolve só as primeiras opções de cada hotel
  // (`config.optionsToShow`, hoje 2) e marca `moreOptions: true` quando há
  // mais. O botão "+" da tela busca o resto de UM hotel:
  //   $.post(handlers.moreOptions, { optionID: options[0].ID, searchSessionID })
  //     .done(s => cache.items[uid].availability = s.results[0].availability)
  // Aqui é a mesma chamada, disparada só quando você pede — uma por clique.
  function pedirOpcoesDoHotel(primeiroOptionID) {
    var p = paramsDoSite();
    p.optionID = primeiroOptionID;
    return new Promise(function (resolve) {
      $.post('/hotels/ashx/options.ashx', p)
        .done(function (j) {
          var res = j && j.results && j.results[0];
          resolve(res && res.availability ? res : null);
        })
        .fail(function (xhr) {
          if (!xhr || !xhr.status) marcarBloqueio('options.ashx');
          resolve(null);
        });
    });
  }

  async function carregarTarifasDoHotel(uid) {
    if (state.bloqueado || !state.catalog) return;
    var base = null;
    state.catalog.forEach(function (c) { if (c.uid === uid && !base) base = c; });
    if (!base) return;

    state.carregandoHotel = base.hotel;
    render();
    var res = await pedirOpcoesDoHotel(base.optionID);
    state.carregandoHotel = null;

    if (res) {
      // mantém a memória do site coerente, igual o "+" dele faz
      var r = siteResults();
      if (r && r.cache && r.cache.items[uid]) {
        r.cache.items[uid].availability = res.availability;
        r.cache.items[uid].hasUpdatedOptions = true;
      }
      state.hoteisCompletos[uid] = true;

      var novos = catalogoDoResultado(res).filter(function (n) {
        return !state.catalog.some(function (c) { return c.optionID === n.optionID; });
      });
      if (novos.length) {
        // entra logo depois das opções que já existiam daquele hotel
        var ultimo = -1;
        state.catalog.forEach(function (c, idx) { if (c.uid === base.uid) ultimo = idx; });
        state.catalog.splice.apply(state.catalog, [ultimo + 1, 0].concat(novos));
      }
      log(novos.length
        ? '+' + novos.length + ' tarifa(s) de ' + base.hotel + '.'
        : base.hotel + ' não tem outras tarifas além das que já estavam aqui.');
    }
    render();
  }

  // composição da busca segundo o próprio motor (availability.distribution)
  // ⚠️ O `distribution` traz só a CONTAGEM de crianças, não as idades. Inventar
  // idade aqui manda para o motor um pax que ele não cotou — e ele responde
  // HTTP 500. Então marcamos como incerta e pedimos no painel.
  // Se a URL/seletor trouxe as idades e a contagem bate, usa (sem conflito).
  function paxesFromDistribution(d) {
    if (!d) return [];
    var out = [];
    var comp = state.idadesBusca;
    var nNA = (d.children || 0) + (d.babies || 0);
    var conhecidas = comp && !comp.conflito && comp.idades.length === nNA ? comp.idades : null;
    var k = 0;
    function push(n, type) {
      for (var i = 0; i < (n || 0); i++) {
        var age = type === '0' ? 30 : (conhecidas ? conhecidas[k++] : null);   // adulto é 30 no site, sempre
        out.push(newPax({
          room: 1, type: type, typeLabel: TYPE_LABEL[type], age: age,
          ageIncerta: type !== '0' && age === null,
          titles: type === '0' ? TITLES_ADULT : TITLES_CHILD,
          treatment: type === '0' ? 'MR' : 'MSTR',
          label: TYPE_LABEL[type] + ' ' + (i + 1) + (type !== '0' && age !== null ? ' (' + age + ' ano(s))' : '')
        }));
      }
    }
    push(d.adults, '0');
    push(d.children, '1');
    push(d.babies, '2');
    return hydrate(out);
  }

  // hotéis + tarifas visíveis na tela de resultados (fallback do catálogo)
  // posição de cada tarifa na tela, para o dropdown seguir o que você vê
  function ordemDaTela() {
    var pos = {}, n = 0;
    $('.result[data-uid]').each(function () {
      var uid = $(this).attr('data-uid');
      $(this).find('[data-option-id]').each(function () {
        pos[uid + '|' + $(this).attr('data-option-id')] = n++;
      });
    });
    return pos;
  }

  function listResultOptions() {
    if (state.catalog) {
      var pos = ordemDaTela();
      state.casadosNoDom = Object.keys(pos).length;
      var lista = state.catalog.map(function (c, i) {
        var k = pos[c.uid + '|' + c.optionID];
        return {
          uid: c.uid, hotel: c.hotel, optionID: c.optionID, label: c.label, _cat: c,
          _ord: k === undefined ? 1e6 + i : k,     // fora da tela vai para o fim
          _naTela: k !== undefined
        };
      });
      lista.sort(function (a, b) { return a._ord - b._ord; });
      return lista;
    }
    return $('.result[data-uid]').map(function () {
      var $r = $(this);
      var uid = $r.attr('data-uid');
      var nome = $r.find('.info-card__image-holder[data-title]').first().attr('data-title') ||
                 $r.find('[data-title]:not([data-toggle])').first().attr('data-title') ||
                 $r.find('.info-card__title, h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
                 uid;
      return $r.find('[data-option-id]').map(function (i) {
        var $o = $(this);
        var preco = $o.find('.result-option__price').first().text().replace(/\s+/g, ' ').trim();
        var quarto = $o.find('.result-option__title, .result-option__name').first()
                       .text().replace(/\s+/g, ' ').trim();
        return {
          uid: uid,
          hotel: nome,
          optionID: $o.attr('data-option-id'),
          label: (quarto || 'opção ' + (i + 1)) + (preco ? ' · ' + preco : '')
        };
      }).get();
    }).get();
  }

  function bookingUrl(uid) {
    if (/booking\.aspx/i.test(window.location.pathname)) return window.location.href;
    var sid = qsParam('searchSessionID');
    // formato do v3 (o que comprovadamente passou): separadores já escapados
    // e o UID com UM encode só — %40, não %2540.
    var hash = 'order%3DetiquetaPrecio%26__scrollToUID%3D' + encodeURIComponent(uid);
    return '/hotels/booking.aspx?searchSessionID=' + encodeURIComponent(sid) + '&hashParams=' + hash;
  }

  // POST 1: seleciona a tarifa na sessão e devolve o HTML da booking (e a URL
  // final: é nela que o site faz o POST 2, via urlChangeParams(location.href))
  async function selectFare(refs) {
    var url = bookingUrl(refs.UID);
    var res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'UID=' + encodeURIComponent(refs.UID) + '&optionID=' + encodeURIComponent(refs.optionID)
    });
    if (!res.ok) throw new Error('POST 1 devolveu HTTP ' + res.status);
    var final = String(res.url || '');
    return { html: await res.text(), url: /booking\.aspx/i.test(final) ? final.split('#')[0] : url };
  }

  // O POST 1 pode voltar: o formulário, o aviso de pontos (que é OK seguir),
  // ou a página de erro genérica do site — que significa sessão/tarifa morta.
  // Antes eu seguia em frente em todos os casos e o POST 2 caía no mesmo erro.
  function classifyBooking(doc, html) {
    if ($(doc).find('.js-booking-paxes-pax-row').length) return 'form';

    var txt = ($(doc).find('body').text() || '').replace(/\s+/g, ' ').toLowerCase();
    if (/desculpe-nos|erro inesperado|houve um erro/.test(txt)) return 'erro';
    // 10/11/2026, tudoazul sem sessão: o POST 1 volta 200 com a caixa de login no
    // lugar dos passageiros. O POST 2 aí só pode dar erro.
    if (/necess[aá]rio realizar seu login/.test(txt)) return 'login';

    // Qualquer outra coisa segue como 'aviso': o objetivo aqui é barrar SÓ a
    // página de erro conhecida. Bloquear o que eu não reconheço já se mostrou
    // pior — trava um caminho que funciona.
    return 'aviso';
  }

  function warningFromHtml(doc) {
    var t = $(doc).find('.booking-warning__content, .booking-warning__title').map(function () {
      return $(this).text().replace(/\s+/g, ' ').trim();
    }).get().join(' — ');
    return t || '';
  }

  // ------------------------------------- preenche uma linha do formulário
  // Serve para as duas formas: a booking.aspx aberta (modo form, `vivo`) e o
  // formulário que o POST 1 devolveu (modo results, fora da página). Faz o que
  // a pessoa faria no site: escolhe CPF, digita, "Validar CPF" (o que a consulta
  // devolveu vai para os mesmos campos que o handler do site preenche), escolhe
  // os campos extras. O que o painel não sabe fica com o padrão do formulário.

  // Valor, do handler `change` do [name=pax-idTDC] (bookingPaxes.min.js). Ele
  // roda no carregamento da página para todas as linhas: com CPF (4), copia o
  // data-cpf-date para os campos de expedição/validade (escondidos); com outro
  // documento, limpa. Fora da página ninguém roda o handler — roda aqui.
  function efeitoDoTipoDeDocumento($row, idTDC) {
    var $o = $row.find('.js-pax-document-expedition'), $s = $row.find('.js-pax-passport-expiration');
    var r = $o.find('input').data('cpf-date'), d = $s.find('input').data('cpf-date');
    if (idTDC === '4') { $o.find('input').val(r); $s.find('input').val(d); }
    else { $o.find('input').val(''); $s.find('input').val(''); }
  }

  // valor efetivo de um campo extra: o escolhido no painel, senão o padrão do formulário
  function valorExtra(p, x) {
    var v = p.extra && p.extra[x.name];
    if (v != null && v !== '') return v;
    // o que a consulta do CPF preenche no site (se o campo for um desses)
    var info = p.status === 'ok' ? p.info : null;
    if (info) {
      var daConsulta = { 'pax-mail': info.Email, 'pax-phone': info.Mobile, 'pax-nationality': info.Nationality }[x.name];
      if (daConsulta != null && daConsulta !== '') return daConsulta;
    }
    return x.padrao || '';
  }

  function preencherLinha($row, pax, vivo) {
    var $fields = $row.find('.js-booking-paxes-fields');
    if (!$fields.length) $fields = $row;

    // 4 = CPF, se a linha oferece CPF. Senão fica o tipo que o formulário trouxe.
    // O 2º argumento impede o handler do site de limpar o número.
    var $tdc = $row.find('[name=pax-idTDC]');
    if ($tdc.find('option[value="4"]').length) $tdc.val('4');
    if (vivo) $tdc.trigger('change', [true]);
    if ($tdc.length) efeitoDoTipoDeDocumento($row, String($tdc.val()));

    var docValue = pax.docKind === 'cpf' ? maskCPF(pax.doc) : (pax.cpfFromFFP || pax.doc);
    var $doc = $row.find('[name=pax-document-number]').val(docValue);
    if (docValue.indexOf('*') > -1) $doc.removeAttr('data-validate');
    else if (!$tdc.length || String($tdc.val()) === '4') $doc.attr('data-validate', '4');

    if (vivo) $fields.find('.booking-paxes__pax-fields-row--extra-fields').show();

    var $tr = $row.find('[name=pax-treatment]');
    if (pax.treatment && $tr.find('option').filter(function () { return this.value === pax.treatment; }).length) {
      $tr.val(pax.treatment);
      if (vivo) $tr.trigger('change');
    }
    $row.find('[name=pax-name]').val(String(pax.name || '').toUpperCase());
    $row.find('[name=pax-surname]').val(String(pax.surname || '').toUpperCase());
    $row.find('[name=pax-birthday]').val(pax.birthday || '');

    // "Validar CPF" com cadastro: o handler do site põe nestes campos o que a
    // consulta devolveu (getHolderInfo.ashx), na mesma ordem
    if (pax.status === 'ok' && pax.info) {
      $fields.find('input[name=pax-mail]').val(pax.info.Email);
      $fields.find('select[name=pax-nationality]').val(pax.info.Nationality);
      $fields.find('input[name=pax-phone]').val(pax.info.Mobile);
    }
    if (pax.ffp) {
      var $ts = $row.find('[name=pax-tipo-socio]');
      if ($ts.find('option[value="Tudo Azul"]').length || !$ts.is('select')) $ts.val('Tudo Azul');
      $row.find('[name=pax-numero-socio]').val(pax.ffp);
    }
    $row.find('input[name=comId]').val(comIdDe(pax));

    // campos obrigatórios do formulário que o painel mostrou (ex.: pax-gender)
    (pax.extras || []).forEach(function (x) {
      var v = valorExtra(pax, x);
      if (v === '') return;
      var $e = $row.find('[name="' + x.name + '"]');
      $e.val(v);
      if (vivo) $e.trigger('change');
    });
  }

  // modo form: a página aberta é a booking.aspx
  function applyPax(pax) {
    if (!pax.$row) return;
    preencherLinha(pax.$row, pax, true);
  }

  // ------------------------------------------------- bookingPaxes (payload)
  // 🔴 Desde a v1.6.4 o POST 2 sai do formulário que o POST 1 devolveu
  // (buildParams). paxFromModel sobrou só para o POST 1 que volta SEM
  // formulário ("pontos insuficientes"): a forma do payload que passou em 13/08
  // (v3), só os campos que o motor usa e nome em maiúsculas.
  // comId = "este CPF é cliente Azul cadastrado". O formulário do site só preenche
  // o campo depois que a consulta do CPF confirma o cadastro. Mandar o CPF de quem
  // não tem cadastro (criança pequena, digitada à mão) derruba o POST 2 com HTTP 500
  // (Edu 10/11/2026: 2 adultos ok + criança de 7 ok + criança de 2 "pendente").
  // Regra: consulta ok → manda; consulta disse "sem cadastro" → não manda;
  // sem consulta: adulto continua como era (titular dos pontos), criança não vai.
  function comIdDe(p) {
    var d = digits(p.doc);
    if (!d) return '';
    if (p.status === 'ok' || p.comId) return d;
    if (p.status === 'manual') return '';
    return parseInt(p.type, 10) === 0 ? d : '';
  }

  function paxFromModel(p) {
    var doc = p.docKind === 'cpf' ? maskCPF(p.doc) : (p.cpfFromFFP || p.doc);

    // 🔴 paxType e paxAge são os da BUSCA, não os calculados do nascimento.
    // O serializer do site faz exatamente isso:
    //   i.paxType = t.data("pax-type"), i.paxAge = t.data("pax-age")
    // A tarifa foi precificada para uma criança de N anos; mandar outra idade
    // (porque o aniversário já passou, por exemplo) faz o motor receber um pax
    // que ele não cotou — e responder HTTP 500. Com dois adultos isso passava
    // batido, porque adulto é adulto em qualquer idade.
    // A idade calculada do nascimento é conferida em problemas() — e barra o
    // envio se não bater, igual ao formulário do site. Criança sem idade nunca
    // chega aqui (problemas() barra); não há idade de chute para criança.
    var tipo = parseInt(p.type, 10);
    var idade = parseInt(p.age, 10);
    if (isNaN(idade) && tipo === 0) idade = 30;
    if (isNaN(idade)) throw new Error((p.label || 'criança') + ': sem a idade da busca — não mando idade de chute');

    return {
      paxType: tipo,
      paxAge: idade,
      treatment: p.treatment || '',
      name: String(p.name || '').toUpperCase(),
      surname: String(p.surname || '').toUpperCase(),
      birthday: p.birthday || '',
      idTDC: doc ? '4' : '',
      documentNumber: doc || '',
      resident: false,
      fidelityProgram: '',
      baggage: '',
      tipoSocio: p.ffp ? 'Tudo Azul' : '',
      numeroSocio: p.ffp || '',
      comId: comIdDe(p),
      numberOfBags: 0,
      baggageSelection: ''
    };
  }

  // ── serializer do site ──
  // Cópia fiel de $jbe.bookingPaxes.getPaxesInfo (include/ctlBookingPaxes/js/
  // bookingPaxes.min.js, versão servida em 10/11/2026 — a de agosto não tinha
  // `gender`), sem o validate() do começo: quem barra aqui é problemas().
  // 🔴 Lê o que o FORMULÁRIO tem, linha por linha: campo que não existe na linha
  // vira `undefined` e não vai no JSON, campo que existe vai com o valor dele
  // (inclusive o padrão de cada <select>). É exatamente o que o site manda.
  // Na booking.aspx aberta, usa o do próprio site ($jbe.bookingPaxes) quando ele valida.
  function PaxDoSite() {
    this.paxType = ''; this.paxAge = ''; this.treatment = ''; this.name = '';
    this.surname = ''; this.birthday = ''; this.nationality = ''; this.gender = ''; this.residenceCountry = '';
    this.city = ''; this.zipCode = ''; this.phone = ''; this.mail = ''; this.address = '';
    this.idTDC = ''; this.documentType = ''; this.documentNumber = ''; this.documentExpiration = '';
    this.documentExpedition = ''; this.resident = false; this.passportCountry = '';
    this.passportExpiration = ''; this.residentCity = ''; this.fidelityProgram = ''; this.baggage = '';
    this.VISA = ''; this.CUIT = ''; this.tipoSocio = ''; this.numeroSocio = '';
  }

  function serializarPaxesComoSite($bookingPaxes) {
    return $bookingPaxes.find('.booking-paxes__room').map(function (_, room) {
      var quarto = {}, $room = $(room), $paxes = $room.find('.booking-paxes__pax');
      quarto.numHab = $room.data('roomnumber');
      quarto.paxes = $paxes.map(function (_, el) {
        var i = new PaxDoSite(), t = $(el), fid = '';
        $.each(t.find('.booking-paxes__fidelity-programs'), function (_, n) {
          var $n = $(n), cia = $n.data('airline'),
              prog = $n.find('[name=pax-fidelity-program]').val(),
              num = $n.find('[name=pax-fidelity-number]').val();
          if (num) fid += cia + ',' + prog + ',' + num + '¬';
        });
        i.paxType = t.data('pax-type');
        i.paxAge = t.data('pax-age');
        i.treatment = t.find('[name=pax-treatment]').val();
        i.name = t.find('[name=pax-name]').val();
        i.surname = t.find('[name=pax-surname]').val();
        i.birthday = t.find('[name=pax-birthday]').val();
        i.nationality = t.find('[name=pax-nationality]').val();
        i.gender = t.find('[name=pax-gender]').val();
        i.residenceCountry = t.find('[name=pax-residence-country]').val();
        i.city = t.find('[name=pax-city]').val();
        i.zipCode = t.find('[name=pax-zip-code]').val();
        i.phone = t.find('[name=pax-phone]').val();
        i.mail = t.find('[name=pax-mail]').val();
        i.address = t.find('[name=pax-address]').val();
        i.idTDC = t.find('[name=pax-idTDC]').val();
        i.documentType = t.find('[name=pax-document-type]').val();
        i.documentNumber = t.find('[name=pax-document-number]').val();
        i.documentExpiration = t.find('[name=pax-document-expiration]').val();
        i.passportExpiration = t.find('[name=pax-passport-expiration]').val();
        i.passportCountry = t.find('[name=pax-passport-country]').val();
        i.residentCity = t.find('[name=pax-resident-city]').val();
        i.documentExpedition = t.find('[name=pax-document-expedition]').val();
        i.flightNumber = t.find('[name=flightNumber]').val();
        i.fidelityProgram = fid;
        i.tipoSocio = t.find('[name=pax-tipo-socio]').val();
        i.numeroSocio = t.find('[name=pax-numero-socio]').val();
        i.comId = t.find('[name=comId]').val();
        var bags = 0, sel = '';
        $.each(t.find('[name=pax-baggage]'), function (_, n) {
          sel += '#' + $(n).closest('.js-flight-baggage').data('baggage-id');
          var $o = $(n).find('option:selected');
          if ($o.length) { bags = Math.max($o.data('number'), bags); sel += ',' + $o.val(); }
        });
        i.numberOfBags = bags;
        i.baggageSelection = sel;
        i.VISA = t.find('[name=pax-visa]').val();
        i.CUIT = t.find('[name=pax-cuit]').val();
        return i;
      }).get();
      return quarto;
    }).get();
  }

  // Cópia fiel de $jbe.getFormParams (base.min.js) — usada só se a página não
  // tiver a do site. 🔴 Junta campos de mesmo nome com vírgula, NA ORDEM e COM OS
  // VAZIOS: os `comId` das linhas viram "cpf1,cpf2,cpf3," (a 4ª sem cadastro).
  function getFormParamsComoSite($t, opts) {
    var n = {}, $i = $t.filter(':input, .date-selector').add($t.find(':input, .date-selector'));
    opts = opts || {};
    $i.each(function () {
      var t = $(this), r, nome;
      if (opts.ignoreDisabled && (t.is(':disabled') || t.closest('.disabled').length > 0)) return;
      if (t.is(':input[name]')) {
        if (t.is("input[type='checkbox']")) { if (t.is(':checked')) r = true; }
        else if (t.is("input[type='radio']")) { if (t.is(':checked')) r = t.val(); }
        else if (t.is('select')) r = t.val() || t.data('selected-value');
        else if (t.is('input[data-mask][data-mask-type=numeric]')) r = parseFloat(t.val().replace(/,/g, ''));
        else r = t.val();
        if (r != null) {
          nome = t.attr('name');
          r = n[nome] != null ? n[nome] + ',' + r : r;
          if ($.isArray(r)) r = r.join();
          n[nome] = r;
        }
      }
      // .date-selector / .zone-selector com data-param-name não existem na tela de passageiros
    });
    return n;
  }

  function formParamsDoSite($t) {
    if (window.$jbe && typeof $jbe.getFormParams === 'function') {
      try { return $jbe.getFormParams($t); } catch (e) { /* cai na cópia */ }
    }
    return getFormParamsComoSite($t);
  }

  // Booking1.getParams + o final do addToBasket (Booking1Class.min.js): o POST 2
  // do site é bookingPaxes + notes + pointsAmount + os campos escondidos do
  // booking-data (os comId) + action/optionID/UID, e some com o que for vazio.
  function paramsComoSite($bd, $doc, paxesInfo, refs) {
    var t = {}, n;
    t.bookingPaxes = JSON.stringify(paxesInfo);
    t.notes = $bd.find('[name=notes]').val() || null;
    var $slider = $doc.find('.points-slider__points-amount');
    if ($slider.length && $slider.val() !== undefined) {
      n = parseInt(String($slider.val()).replace(/\D/g, ''), 10);
      if (n === 0) n = '0';
    }
    t.pointsAmount = n;
    $.extend(t, formParamsDoSite($bd.find('.booking-data__hidden-fields')));
    t.action = 'book';
    t.optionID = refs.optionID || '';
    t.UID = refs.UID || '';
    $.each(t, function (k, v) {
      // mesma regra do site: (null != t && "" != t) || delete — comparação frouxa de propósito
      if (!(v != null && '' != v)) delete t[k];
    });
    return t;
  }

  // linha do formulário ↔ pax do painel: pela posição em que readPaxRows leu
  function paxDaLinha(i) {
    var achou = state.paxes.filter(function (p) { return p.rowIndex === i; });
    return achou[0] || state.paxes[i];
  }

  // ── o POST 2 ──
  //   modo form     → preenche a booking.aspx aberta e usa o serializer DELA
  //   modo results  → preenche o formulário que o POST 1 devolveu (fora da página)
  //                   e serializa com a cópia do serializer do site
  //   POST 1 sem formulário ("pontos insuficientes") → builder próprio, como antes
  function buildParams(state) {
    if (!state.refs) throw new Error('UID/optionID não encontrados — informe a tarifa no painel.');
    var $bd, $doc, info = null;

    if (state.mode === 'form') {
      $doc = $(document);
      $bd = $('.booking-data');
      try {
        info = window.$jbe && $jbe.bookingPaxes && $jbe.bookingPaxes.getPaxesInfo($bd.find('.booking-paxes'));
      } catch (e) { info = null; }
      if (!info || !info.length) info = serializarPaxesComoSite($bd.find('.booking-paxes'));
      state.ultimoBuilder = 'formulário da página';
      return paramsComoSite($bd, $doc, info, state.refs);
    }

    if (state.post1 && state.post1.doc) {
      $doc = $(state.post1.doc);
      $bd = $doc.find('.booking-data').first();
      var $rows = $bd.find('.js-booking-paxes-pax-row');
      if ($rows.length && $rows.length === state.paxes.length) {
        $rows.each(function (i) { preencherLinha($(this), paxDaLinha(i), false); });
        info = serializarPaxesComoSite($bd.find('.booking-paxes'));
        state.ultimoBuilder = 'formulário do POST 1';
        return paramsComoSite($bd, $doc, info, state.refs);
      }
    }

    // sem formulário: o builder próprio de sempre, com o comId no formato do site
    var rooms = [], byRoom = {};
    state.paxes.forEach(function (p) {
      var k = String(p.room);
      if (!byRoom[k]) { byRoom[k] = { numHab: parseInt(k, 10) || 1, paxes: [] }; rooms.push(byRoom[k]); }
      byRoom[k].paxes.push(paxFromModel(p));
    });
    state.ultimoBuilder = 'builder próprio (POST 1 sem formulário)';
    var params = { bookingPaxes: JSON.stringify(rooms), action: 'book',
                   optionID: state.refs.optionID, UID: state.refs.UID };
    // comId: um por passageiro, na ordem, vazio para quem não tem — o que o
    // getFormParams do site junta das linhas (antes ia só a lista dos preenchidos)
    var comIds = state.paxes.map(comIdDe);
    if (comIds.some(Boolean)) params.comId = comIds.join(',');
    $.each(params, function (k, v) {
      if (v === null || v === undefined || v === '') delete params[k];
    });
    return params;
  }

  // O POST 2 vai por fetch, não por navegação. Assim dá para LER a resposta:
  // se o site devolver a página de erro, nada foi criado e a gente mostra o
  // motivo em vez de jogar você numa tela de erro sem contexto. Deu certo,
  // navegamos para a URL final (GET), sem repetir o POST — repetir criaria
  // uma segunda reserva.
  async function submitBooking(state, params) {
    var url = state.mode === 'form'
      ? (window.urlChangeParams ? urlChangeParams(window.location.href) : window.location.href)
      : ((state.post1 && state.post1.url) || bookingUrl(state.refs.UID));

    // o que foi no POST 2, para o diagnóstico (só tipo e idade, nada pessoal)
    try {
      state.ultimoEnvio = JSON.parse(params.bookingPaxes).map(function (r) {
        return r.paxes.map(function (p) { return (p.paxType === 0 ? 'A' : 'C') + p.paxAge; }).join(',');
      }).join(' | ');
    } catch (e) { state.ultimoEnvio = '(não li o bookingPaxes)'; }
    state.ultimoEnvioCampos = resumoDoEnvio(params);

    if (state.mode === 'form' && window.sendPost) { window.sendPost(url, params); return; }

    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var r, html;
    try {
      r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body,
        redirect: 'follow'
      });
      html = await r.text();
    } catch (e) {
      log('❌ o POST 2 não completou: ' + e.message + '\nNada foi criado.');
      return;
    }

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var txt = ($(doc).find('body').text() || '').replace(/\s+/g, ' ').trim();

    if (/desculpe-nos|erro inesperado|houve um erro/i.test(txt)) {
      state.ultimaRespostaErro = 'HTTP ' + r.status + ' · ' + txt.slice(0, 600);
      var crian = state.paxes.filter(function (p) { return p.type !== '0'; })
                             .map(function (p) { return +p.age; });
      var comp = state.idadesBusca;
      log('❌ O site respondeu com a PÁGINA DE ERRO no POST 2 (HTTP ' + r.status + ').\n' +
          'A reserva não foi criada — você continua na tela de resultados.\n\n' +
          'Antes de mandar eu conferi' +
          (crian.length
            ? ': crianças com ' + txtIdades(crian) + ' ano(s), iguais às da busca' +
              (comp ? ' (' + comp.fonte + ')' : '') + ', e o nascimento de cada uma batendo com a idade no check-in;'
            : ':') +
          ' todos os passageiros completos, nenhuma consulta de CPF com erro.\n' +
          'Então o mais provável é a sessão/tarifa ter vencido (o optionID morre junto com a busca): ' +
          'refaça a busca do zero, abra o painel de novo e tente outra vez.\n\n' +
          'Se repetir, clique em 🩺 e me mande o diagnóstico.\n' +
          'resposta: ' + txt.slice(0, 160) + '…');
      render();
      return;
    }

    if (/confirmbooking/i.test(r.url)) {
      log('✅ reserva criada — abrindo a tela de confirmação…');
      window.location.href = r.url;                 // GET, sem repetir o POST
      return;
    }

    // Respondeu algo que não é erro nem redirecionou: mostra a resposta na aba.
    log('resposta recebida (HTTP ' + r.status + ') — abrindo…');
    document.open(); document.write(html); document.close();
  }


  // ------------------------------------------------------------- interface
  var state = { mode: null, paxes: [], refs: null, fareLoaded: false,
               catalog: null, catalogFonte: '', checkin: '',
               hoteisCompletos: {}, carregandoHotel: null, bloqueado: null,
               manual: { rooms: '1', adults: '', children: '' },
               idadesBusca: null, idadesServidor: null, dist: null, consultando: 0,
               divergencia: '', ultimoBloqueio: null, ultimoEnvio: '',
               post1: null, formServidor: '', ultimoBuilder: '', ultimoEnvioCampos: '' };

  // check-in e composição do motor já na abertura (memória do site, 0
  // requisições): o padrão salvo casa cada criança pela idade no check-in
  (function () {
    var c = catalogoDoCacheDoSite();
    if (c && c[0]) { state.checkin = brDate(c[0].checkin); state.dist = c[0].dist || null; }
  })();

  var domRows = readPaxRows(document, true);
  if (domRows.length) {
    state.mode = 'form';
    state.paxes = hydrate(domRows);
    state.formServidor = descreverFormulario(domRows, document);
    state.fareLoaded = true;
  } else {
    var barra = readSearchBarPaxes();
    state.mode = $('.result[data-uid]').length || barra.length ? 'results' : 'headless';
    state.paxes = barra;
    state.fromSearchBar = barra.length > 0;
    state.fareLoaded = barra.length > 0;      // já dá pra preencher os paxes
  }
  state.refs = detectRefs();
  state.paxes.forEach(function (p, i) { if (!p.doc) p.doc = PRESET_DOCS[i] || ''; });

  var old = document.getElementById('azul-pax-panel');
  if (old) old.remove();

  var panel = document.createElement('div');
  panel.id = 'azul-pax-panel';
  panel.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'width:410px', 'max-height:92vh',
    'overflow:auto', 'z-index:2147483647', 'background:#101828', 'color:#e6edf7',
    'font:13px/1.45 system-ui,Segoe UI,Arial', 'border-radius:10px',
    'box-shadow:0 10px 40px rgba(0,0,0,.5)', 'padding:14px'
  ].join(';');
  document.body.appendChild(panel);

  var css = 'width:100%;box-sizing:border-box;padding:5px 7px;margin:2px 0;border-radius:5px;' +
            'border:1px solid #2d3748;background:#0b1220;color:#e6edf7';
  var btn = 'padding:8px;border:0;border-radius:6px;color:#fff;cursor:pointer';

  function summary() {
    if (!state.paxes.length) return 'nenhum pax carregado ainda';
    var ad = state.paxes.filter(function (p) { return p.type === '0'; }).length;
    var outros = state.paxes.filter(function (p) { return p.type !== '0'; })
      .map(function (p) {
        return p.typeLabel.toLowerCase() + ' ' + (p.age == null || isNaN(p.age) ? '?' : p.age) + 'a';
      });
    var rooms = {};
    state.paxes.forEach(function (p) { rooms[p.room] = 1; });
    var comp = state.idadesBusca;
    return ad + ' adulto(s)' + (outros.length ? ' + ' + outros.join(', ') : '') +
           ' · ' + Object.keys(rooms).length + ' quarto(s) · ' + state.paxes.length + ' pax' +
           (outros.length && comp && !comp.conflito ? ' · idades: ' + comp.fonte : '');
  }

  function fareBlock() {
    if (state.mode === 'form') return '';

    var opts = listResultOptions();
    var grupos = [], porHotel = {};
    opts.forEach(function (o, i) {
      if (!porHotel[o.hotel]) { porHotel[o.hotel] = []; grupos.push(o.hotel); }
      porHotel[o.hotel].push({ o: o, i: i });
    });
    var sel = '';
    if (opts.length) {
      sel = '<select data-f="pick" style="' + css + '">' +
        '<option value="">— escolher hotel / tarifa (' + opts.length + ' opções na tela) —</option>' +
        grupos.map(function (h) {
          return '<optgroup label="' + esc(h) + '">' +
            porHotel[h].map(function (x) {
              var marcado = state.refs && state.refs.optionID === x.o.optionID ? ' selected' : '';
              return '<option value="' + x.i + '"' + marcado + '>' +
                     esc(x.o.label) + (x.o._naTela === false ? ' (ainda não carregada na tela)' : '') +
                     '</option>';
            }).join('') + '</optgroup>';
        }).join('') + '</select>';
    }

    // tarifas extras do hotel escolhido — uma requisição, e só quando você pede
    var maisBtn = '';
    if (state.refs && state.refs.UID && !state.bloqueado) {
      var uid = state.refs.UID;
      var jaTem = state.hoteisCompletos[uid] || hotelJaCompleto(uid);
      if (state.carregandoHotel) {
        maisBtn = '<div style="color:#9aa7b8;margin-top:4px">⏳ buscando as tarifas de ' +
                  esc(state.carregandoHotel) + '…</div>';
      } else if (!jaTem) {
        maisBtn = '<button data-act="mais-tarifas" style="' + btn +
                  ';background:#4a5568;width:100%;margin-top:4px">＋ ver todas as tarifas deste hotel</button>';
      }
    }

    return '' +
    '<div style="border:1px solid ' + (state.faltaTarifa ? '#fc8181' : '#2d3748') +
         ';border-radius:8px;padding:8px;margin-bottom:10px">' +
      '<div style="color:' + (state.faltaTarifa ? '#fc8181' : '#9aa7b8') + ';margin-bottom:4px">Tarifa' +
        (state.refs ? ' — ' + esc(state.refs.hotel || state.refs.UID) + ' (' + esc(state.refs.from) + ')'
                    : ' — nenhuma escolhida') + '</div>' +
      sel + maisBtn +
      (state.fromSearchBar ? '' :
        '<button data-act="load-fare" style="' + btn + ';background:#2b6cb0;width:100%;margin-top:4px">Carregar tarifa e ler os passageiros</button>') +
    '</div>';
  }

  // composição na mão — usada quando não dá pra ler da busca nem do servidor
  function manualBlock() {
    if (state.paxes.length) return '';
    return '' +
    '<div style="border:1px solid #ecc94b55;border-radius:8px;padding:8px;margin-bottom:10px">' +
      '<div style="color:#ecc94b;margin-bottom:4px">Composição — não consegui ler da barra de busca</div>' +
      '<div style="display:flex;gap:4px;align-items:center">' +
        '<input data-f="m-rooms" value="' + esc(state.manual.rooms) + '" placeholder="quartos" style="' + css + ';width:70px">' +
        '<input data-f="m-adults" value="' + esc(state.manual.adults) + '" placeholder="adultos" style="' + css + ';width:80px">' +
        '<input data-f="m-children" value="' + esc(state.manual.children) + '" placeholder="idades das crianças (ex: 7,2)" style="' + css + '">' +
      '</div>' +
      '<button data-act="build-manual" style="' + btn + ';background:#4a5568;width:100%;margin-top:4px">Montar passageiros</button>' +
    '</div>';
  }

  function buildManualPaxes() {
    var rooms = Math.max(1, parseInt(state.manual.rooms, 10) || 1);
    var adults = Math.max(0, parseInt(state.manual.adults, 10) || 0);
    var ages = String(state.manual.children || '').split(/[,;\s]+/)
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x); });

    if (!adults) { log('❌ informe pelo menos 1 adulto.'); return; }

    var out = [], perRoomA = Math.ceil(adults / rooms), restA = adults, ci = 0;
    for (var r = 1; r <= rooms; r++) {
      var nA = Math.min(perRoomA, restA); restA -= nA;
      for (var a = 0; a < nA; a++) {
        out.push(newPax({
          room: r, type: '0', typeLabel: 'Adulto', age: 30, titles: TITLES_ADULT, treatment: 'MR',
          label: 'Adulto ' + (a + 1) + (rooms > 1 ? ' · quarto ' + r : '')
        }));
      }
      if (r === rooms) {
        for (; ci < ages.length; ci++) {
          out.push(newPax({
            room: r, type: ages[ci] < 2 ? '2' : '1', typeLabel: ages[ci] < 2 ? 'Bebê' : 'Criança',
            age: ages[ci], titles: TITLES_CHILD, treatment: 'MSTR',
            label: (ages[ci] < 2 ? 'Bebê ' : 'Criança ') + (ci + 1) + ' (' + ages[ci] + ' ano(s))'
          }));
        }
      }
    }
    state.paxes = hydrate(out);
    state.fareLoaded = true;
    render();
    log('composição montada: ' + out.length + ' pax. Informe os documentos.');
  }

  // avisos sobre as idades, no topo da lista de passageiros
  function idadesBlock() {
    var comp = state.idadesBusca, h = '';
    var box = 'border-radius:8px;padding:8px;margin-bottom:10px;font-size:12px;color:#e6edf7;';
    if (state.divergencia) {
      h += '<div style="' + box + 'border:1px solid #fc8181;background:#2d1414">' +
           '<strong style="color:#fc8181">⛔ Idades não batem com a tela de reserva do site</strong><br>' +
           esc(state.divergencia) + '</div>';
    }
    var faltam = state.paxes.some(function (p) { return p.type !== '0' && (p.age == null || isNaN(p.age)); });
    if (comp && comp.conflito && faltam) {
      h += '<div style="' + box + 'border:1px solid #ecc94b;background:#1a1a10">' +
           '<strong style="color:#ecc94b">⚠️ Não tenho certeza das idades das crianças</strong><br>' +
           'As fontes da página não batem: ' + esc(comp.conflito) + '.<br>' +
           'Informe abaixo a idade de cada criança <strong>exatamente como foi pesquisada</strong>, na ordem da busca. ' +
           'Idade diferente da cotada faz o site recusar a reserva. Na dúvida, refaça a busca.</div>';
    } else if (faltam) {
      h += '<div style="' + box + 'border:1px solid #ecc94b;background:#1a1a10">' +
           '<strong style="color:#ecc94b">⚠️ Falta a idade das crianças</strong><br>' +
           'Não consegui ler da página. Informe abaixo a idade de cada uma exatamente como foi pesquisada.</div>';
    }
    return h;
  }

  function paxBlock() {
    if (!state.fareLoaded) return '<div style="color:#9aa7b8">Defina a composição acima (ou carregue a tarifa) para listar os passageiros.</div>';
    return idadesBlock() + state.paxes.map(function (p, i) {
      var color = p.status === 'ok' ? '#48bb78' : p.status === 'manual' ? '#ecc94b' :
                  p.status === 'erro' ? '#fc8181' : p.status === 'padrão' ? '#63b3ed' : '#718096';
      return '' +
      '<div style="border:1px solid #2d3748;border-radius:8px;padding:8px;margin-bottom:8px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">' +
          '<strong style="flex:1">' + esc(p.label || (p.typeLabel + ' ' + (i + 1))) + '</strong>' +
          '<span style="color:' + color + '">' + esc(p.status) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<select data-f="docKind" data-i="' + i + '" style="' + css + ';width:92px">' +
            '<option value="cpf"' + (p.docKind === 'cpf' ? ' selected' : '') + '>CPF</option>' +
            '<option value="ffp"' + (p.docKind === 'ffp' ? ' selected' : '') + '>TudoAzul</option>' +
          '</select>' +
          '<input data-f="doc" data-i="' + i + '" value="' + esc(p.doc) + '" placeholder="documento" style="' + css + '">' +
          '<button data-act="lookup" data-i="' + i + '" style="' + btn + ';background:#2b6cb0;padding:5px 9px">🔍</button>' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<input data-f="name" data-i="' + i + '" value="' + esc(p.name) + '" placeholder="Nome" style="' + css + '">' +
          '<input data-f="surname" data-i="' + i + '" value="' + esc(p.surname) + '" placeholder="Sobrenome" style="' + css + '">' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<input data-f="birthday" data-i="' + i + '" value="' + esc(p.birthday) + '" placeholder="dd/mm/aaaa" style="' + css + ';width:110px">' +
          '<select data-f="treatment" data-i="' + i + '" style="' + css + ';width:120px">' +
            p.titles.map(function (t) {
              return '<option value="' + esc(t.value) + '"' + (p.treatment === t.value ? ' selected' : '') + '>' + esc(t.text) + '</option>';
            }).join('') +
          '</select>' +
          '<input data-f="ffp" data-i="' + i + '" value="' + esc(p.ffp) + '" placeholder="nº TudoAzul" style="' + css + '">' +
        '</div>' +
        extrasBlock(p, i) +
        (p.ageIncerta
          ? '<div style="display:flex;gap:4px;align-items:center">' +
              '<span style="color:#ecc94b;font-size:11px;flex:1">idade usada na busca (anos, a mesma da pesquisa):</span>' +
              '<input data-f="age" data-i="' + i + '" value="' + (p.age == null ? '' : esc(p.age)) + '" ' +
                     'placeholder="anos" style="' + css + ';width:70px">' +
            '</div>'
          : '') +
      '</div>';
    }).join('') +
    '<div style="display:flex;gap:6px;margin:-2px 0 4px">' +
      '<button data-act="lookup-all" title="consulta cada documento no cadastro do TudoAzul" ' +
              'style="' + btn + ';background:#2b6cb0;flex:1">Consultar CPFs</button>' +
      '<button data-act="save-preset" title="salvar estes passageiros como padrão" ' +
              'style="' + btn + ';background:#2c5282;flex:1">💾 Salvar</button>' +
      '<button data-act="clear-preset" title="apagar o padrão salvo deste navegador" ' +
              'style="' + btn + ';background:#742a2a;flex:0 0 auto;padding:8px 12px">\uD83D\uDDD1\uFE0F Apagar</button>' +
    '</div>';
  }

  // campos obrigatórios que o formulário do site tem nesta linha e o painel não
  // cobre (ex.: sexo). Opções e rótulo vêm do próprio formulário.
  function extrasBlock(p, i) {
    if (!p.extras || !p.extras.length) return '';
    return p.extras.map(function (x) {
      var v = valorExtra(p, x);
      var campo = x.tag === 'select'
        ? '<select data-f="x" data-n="' + esc(x.name) + '" data-i="' + i + '" style="' + css + '">' +
            x.options.map(function (o) {
              return '<option value="' + esc(o.value) + '"' + (o.value === v ? ' selected' : '') + '>' + esc(o.text || o.value) + '</option>';
            }).join('') +
          '</select>'
        : '<input data-f="x" data-n="' + esc(x.name) + '" data-i="' + i + '" value="' + esc(v) + '" style="' + css + '">';
      return '<div style="display:flex;gap:4px;align-items:center">' +
        '<span style="color:' + (v === '' ? '#ecc94b' : '#9aa7b8') + ';font-size:11px;width:120px" title="campo do formulário do site: ' +
          esc(x.name) + '">' + esc(x.label) + ' *</span>' + campo + '</div>';
    }).join('');
  }

  function header() {
    var modo = state.mode === 'form' ? 'formulário' : state.mode === 'results' ? 'resultados' : 'sem form';
    return '' +
      '<div data-act="drag" style="display:flex;align-items:center;gap:8px;margin:-14px -14px 8px;padding:10px 14px;' +
             'background:#0a2540;border-radius:10px 10px 0 0;cursor:move;user-select:none">' +
        '<span style="width:6px;height:18px;background:#00a3e0;border-radius:3px"></span>' +
        '<strong style="flex:1">Reserva TudoAzul <span style="font-weight:400;color:#8aa0b8;font-size:11px">v' + VERSION + '</span></strong>' +
        '<span style="color:#8aa0b8;font-size:11px">' + modo + '</span>' +
        '<button data-act="min" title="minimizar" style="background:none;border:0;color:#9aa7b8;cursor:pointer;font-size:15px">' +
          (state.min ? '▢' : '—') + '</button>' +
        '<button data-act="close" title="fechar" style="background:none;border:0;color:#9aa7b8;cursor:pointer;font-size:15px">✕</button>' +
      '</div>';
  }

  function render() {
    if (state.min) {
      panel.style.width = '260px';
      panel.innerHTML = header();
      return;
    }
    panel.style.width = '410px';
    panel.innerHTML =
      header() +
      '<div style="color:#9aa7b8;margin-bottom:10px">' + esc(summary()) +
        (state.cookieAviso ? ' · <span title="sem gravar cookie nenhum">🍪 ' + esc(state.cookieAviso) + '</span>' : '') +
      '</div>' +
      fareBlock() +
      manualBlock() +
      paxBlock() +
      (state.fareLoaded
        ? // ação principal, sozinha, com o aviso colado nela
          '<div style="margin-top:12px;padding:8px 10px;border-radius:6px;' +
               'border-left:3px solid #ecc94b;background:#1a1a10;color:#c9d6e5;font-size:12px">' +
            'Nada é reservado ao clicar: você vai para a tela de confirmação. ' +
            'Só que, no caminho, o site deixa de exibir as <strong>políticas do hotel</strong> — ' +
            'confira elas lá antes de finalizar.' +
          '</div>' +
          '<button data-act="send" style="' + btn + ';background:#2f855a;width:100%;margin-top:8px;' +
                 'font-weight:600;font-size:14px;padding:11px">Continuar para o cupom →</button>'
        : '') +
      '<div id="azul-pax-log" style="margin-top:10px;padding:8px;border-radius:6px;background:#0b1220;' +
        'border:1px solid #2d3748;color:#c9d6e5;white-space:pre-wrap;font-size:12px;min-height:18px"></div>' +
      // rodapé: diagnóstico + apoio
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #1e2836;display:flex;' +
             'align-items:center;gap:8px;font-size:12px">' +
        '<button data-act="diag" title="copia um relatório técnico, sem dado pessoal" ' +
                'style="' + btn + ';background:#2d3748;border:1px solid #4a5568;color:#c9d6e5;' +
                'padding:6px 10px;font-size:12px">🩺 Diagnóstico</button>' +
        '<a href="' + KOFI + '" target="_blank" rel="noopener" ' +
           'style="color:#00a3e0;text-decoration:none;margin-left:auto" ' +
           'title="ko-fi.com/eduoct">☕ Salvou sua viagem? Me paga um cafezinho de aeroporto</a>' +
      '</div>';
    if (lastLog) panel.querySelector('#azul-pax-log').textContent = lastLog;
  }

  var lastLog = '';
  function log(msg) {
    lastLog = msg;
    var el = panel.querySelector('#azul-pax-log');
    if (el) el.textContent = msg;
  }

  // de onde saiu cada idade de criança (sem nada pessoal)
  function descreverIdades() {
    var c = state.idadesBusca, d = state.dist;
    var dist = d ? ' · distribution do motor: ' + (d.adults || 0) + ' adulto(s), ' +
                   ((d.children || 0) + (d.babies || 0)) + ' criança(s)' : '';
    if (!c) return 'não li da página (sem barra/seletor/URL)' + dist;
    return txtIdades(c.idades) + ' · fonte: ' + c.fonte + ' · ' +
      c.fontes.map(function (f) { return f.nome + ' [' + f.adultos + 'A; ' + txtIdades(f.idades) + ']'; }).join(' · ') +
      (c.conflito ? ' · ⚠️ FONTES DIVERGEM' : '') + dist;
  }

  // Diagnóstico para suporte: nada de nome, CPF ou nº de programa — só o que
  // ajuda a entender por que quebrou.
  function copiarDiagnostico() {
    var d = [
      'Reserva TudoAzul v' + VERSION,
      'url: ' + window.location.pathname,
      'modo: ' + state.mode,
      'catálogo: ' + (state.catalog
        ? state.catalog.length + ' tarifas · fonte: ' + (state.catalogFonte || '?') +
          ' · hotéis completados na mão: ' + Object.keys(state.hoteisCompletos).length
        : 'não carregado'),
      '$jbe.results: ' + (siteResults()
        ? 'sim · itens no cache: ' + Object.keys((siteResults().cache || {}).items || {}).length +
          ' · hasAllOptions: ' + !!((siteResults().options.config || {}).hasAllOptions)
        : 'não encontrado'),
      'bloqueio da proteção: ' + (state.bloqueado || 'não'),
      'tarifa escolhida: ' + (state.refs ? (state.refs.from + (state.refs.hotel ? ' · ' + state.refs.hotel : '')) : 'nenhuma'),
      'check-in: ' + (state.checkin || '—'),
      resumoPreset(),
      'tarifas casadas no DOM: ' + (state.casadosNoDom || 0),
      'cookies do site: ' + (nomesDeCookie()
                              .filter(function (n) { return /cookie|consent|lgpd|optanon|onetrust/i.test(n); })
                              .join(', ') || '(nenhum de consentimento)'),
      'accept-cookies presente: ' + ((document.cookie.match(/accept-cookies=/g) || []).length),
      'OneTrust: ' + (state.oneTrust && state.oneTrust.achou
        ? 'tarja presente · botão ' + state.oneTrust.botao +
          ' · cliquei: ' + (state.oneTrust.clicou ? 'sim' : 'não') +
          ' · OptanonAlertBoxClosed depois: ' + (state.oneTrust.gravou ? 'sim' : 'NÃO')
        : 'sem tarja nesta página'),
      'tarjas encontradas: ' + ((state.tarjas || []).join(' | ') || '(nenhuma)'),
      'botão de aceite clicado: ' + (state.aceiteClicado || '(nenhum)'),
      'pax: ' + state.paxes.length + ' (' +
        state.paxes.map(function (p) {
          return p.typeLabel + '/' + (p.age == null || isNaN(p.age) ? '?' : p.age) + '/' + p.status;
        }).join(', ') + ')',
      'idades da busca: ' + descreverIdades(),
      'tela de reserva (POST 1): ' + (state.idadesServidor
        ? 'crianças ' + txtIdades(state.idadesServidor) + ' · linhas tipo/idade/data: ' + (state.linhasServidor || '?')
        : '—'),
      'formulário do POST 1: ' + (state.formServidor || '—'),
      'POST 2 enviado com: ' + (state.ultimoEnvio || '—'),
      'POST 2 montado por: ' + (state.ultimoBuilder || '—') +
        (state.ultimoEnvioCampos ? ' · ' + state.ultimoEnvioCampos : ''),
      'checagem antes do POST 2: ' + (state.ultimoBloqueio
        ? 'BLOQUEADO — ' + state.ultimoBloqueio.join(' | ')
        : (state.ultimoEnvio ? 'ok' : 'ainda não rodou')),
      'jQuery: ' + ($.fn && $.fn.jquery ? $.fn.jquery : '?'),
      'navegador: ' + navigator.userAgent,
      (state.ultimaRespostaErro ? '--- resposta do POST 2 ---\n' + state.ultimaRespostaErro : ''),
      '--- último log ---',
      lastLog || '(vazio)'
    ].join('\n');

    console.log(d);
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(d);
        log('🩺 diagnóstico copiado — cole na mensagem de suporte.\n(sem nome, CPF ou nº de programa)');
        return;
      }
    } catch (e) { /* segue pro fallback */ }
    log('🩺 diagnóstico impresso no console (F12) — copie de lá.');
  }

  // ------------------------------------------------------------- ações
  async function doLookup(p) {
    if (!p) return;
    if (!digits(p.doc)) { p.status = 'sem doc'; render(); return; }
    p.status = '…';
    state.consultando++;
    render();
    try {
      var d = await lookup(p);
      p.name = d.Name || p.name;
      p.surname = d.LastName || p.surname;
      p.birthday = normalizarData(d.BirthDate) || p.birthday;
      p.ffp = d.identifierNoFFP || p.ffp;
      p.comId = digits(p.doc);
      if (p.docKind === 'ffp') p.cpfFromFFP = d.identifierNoCPF || '';
      // o handler do "Validar CPF" do site também põe isto no formulário (preencherLinha)
      p.info = { Email: d.Email, Mobile: d.Mobile, Nationality: d.Nationality };
      p.status = 'ok';
    } catch (err) {
      p.comId = '';
      p.info = null;
      p.status = /sem cadastro/.test(err.message) ? 'manual' : 'erro';
      log('[' + p.label + '] ' + err.message +
          (p.status === 'manual' ? ' — preencha os campos à mão'
                                 : ' — clique 🔍 de novo; sem cadastro no TudoAzul, preencha à mão'));
    } finally {
      state.consultando = Math.max(0, state.consultando - 1);
    }
    render();
  }

  // 🔴 O que impede o POST 2. Antes da v1.6.2 isto era só aviso dentro do
  // confirm(): dava para mandar criança sem nascimento, com a consulta do CPF
  // em erro ou ainda rodando — e o motor respondia HTTP 500.
  // A regra de idade é a do próprio site (isValidAge, base.min.js): criança
  // tem que ter EXATAMENTE a idade da busca na data do check-in; adulto, no
  // mínimo `adultAgeFrom`. O formulário do site barra isso; o atalho pula o
  // formulário, então barramos aqui.
  // Nenhuma mensagem leva nome, CPF ou nascimento (vão para o diagnóstico).
  function problemas() {
    var out = [];
    if (state.consultando > 0 || state.paxes.some(function (p) { return p.status === '…'; })) {
      out.push('ainda há consulta de CPF em andamento — espere terminar');
    }
    if (state.divergencia) out.push(state.divergencia);

    var d = state.dist;
    if (d && state.mode !== 'form' && state.paxes.length) {
      var nA = state.paxes.filter(function (p) { return p.type === '0'; }).length;
      var nC = state.paxes.length - nA;
      var eA = d.adults || 0, eC = (d.children || 0) + (d.babies || 0);
      if (nA !== eA || nC !== eC) {
        out.push('a busca é para ' + eA + ' adulto(s) e ' + eC + ' criança(s), o painel tem ' +
                 nA + ' e ' + nC + ' — recarregue a página e abra o painel de novo');
      }
    }

    state.paxes.forEach(function (p) {
      var nome = p.label || p.typeLabel;
      var crianca = p.type !== '0';
      var idade = idadeOuNull(p.age);
      if (crianca && idade === null) out.push(nome + ': falta a idade usada na busca');
      if (p.status === 'erro') {
        out.push(nome + ': a consulta do CPF falhou — clique 🔍 de novo; sem cadastro, preencha à mão');
      }
      // documento: só se a linha do formulário do site tem o campo (sem formulário lido, sempre)
      var pedeDoc = !p.campos || p.campos.indexOf('pax-document-number') > -1;
      if (pedeDoc && !digits(p.doc)) out.push(nome + ': falta o documento');
      if (!String(p.name || '').trim() || !String(p.surname || '').trim()) out.push(nome + ': falta nome/sobrenome');
      (p.extras || []).forEach(function (x) {
        if (valorExtra(p, x) === '') {
          out.push(nome + ': o formulário do site pede "' + x.label + '" — escolha/preencha no painel');
        }
      });
      if (!parseBR(p.birthday)) { out.push(nome + ': nascimento vazio ou inválido (dd/mm/aaaa)'); return; }

      var ref = p.tripDate || state.checkin;
      var a = ageAt(p.birthday, ref);
      if (a === null) return;                      // sem data de check-in: fica em avisos()
      if (!crianca && a < p.adultAgeFrom) {
        out.push(nome + ': pelo nascimento tem ' + a + ' ano(s) no check-in — adulto precisa de ' + p.adultAgeFrom + '+');
      }
      if (crianca && idade !== null && a !== idade) {
        out.push(nome + ': pelo nascimento terá ' + a + ' ano(s) no check-in (' + ref + '), mas a busca foi para ' +
                 idade + ' — o site exige a mesma idade. Confira se os dados não são de outra criança; ' +
                 'se a idade da busca estava errada, refaça a busca');
      }
    });
    return out;
  }

  // o que não impede, mas vale saber
  function avisos() {
    var w = [];
    state.paxes.forEach(function (p) {
      if (parseBR(p.birthday) && !parseBR(p.tripDate || state.checkin)) {
        w.push((p.label || p.typeLabel) + ': não sei a data do check-in — não deu para conferir a idade pelo nascimento');
      }
      if (p.tiposDoc && p.tiposDoc.indexOf('4') < 0 && digits(p.doc)) {
        w.push((p.label || p.typeLabel) + ': o formulário do site não oferece CPF nesta linha — vai o tipo de documento padrão dele (' +
               (p.selectsPadrao['pax-idTDC'] || '?') + ')');
      }
    });
    return w;
  }

  function bloquear(lista, quando) {
    state.ultimoBloqueio = lista.slice();
    render();
    log('⛔ Não mandei a reserva' + (quando ? ' (' + quando + ')' : '') + '. Falta acertar:\n• ' +
        lista.join('\n• ') + '\n\nNada foi criado.');
  }

  async function loadFare() {
    if (!state.refs || !state.refs.UID || !state.refs.optionID) {
      log('❌ informe UID e optionID (ou escolha uma opção da tela de resultados).');
      return;
    }
    if (state.consultando > 0) {
      log('⏳ espere a consulta dos CPFs terminar — trocar a tarifa no meio embaralha os passageiros.');
      return false;
    }
    log('POST 1 — selecionando a tarifa…');
    state.post1 = null;
    try {
      var r1 = await selectFare(state.refs);
      var html = r1.html;
      // 🔴 O formulário que o POST 1 devolve é guardado: o POST 2 sai DELE, linha
      // por linha, como o site faria (buildParams). DOMParser: nada roda, nada carrega.
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var tipo = classifyBooking(doc, html);
      var rows = readPaxRows(doc, false);
      var aviso = warningFromHtml(doc);

      if (tipo === 'login') {
        log('❌ O site pediu login na tela de reserva ("É necessário realizar seu Login para seguir com a reserva").\n' +
            'Sem login o TudoAzul não mostra os passageiros nem aceita a reserva.\n\n' +
            'Faça login no site, refaça a busca e abra o painel de novo.\n' +
            'NÃO mandei o POST 2.');
        return false;
      }

      if (tipo === 'erro') {
        log('❌ O POST 1 voltou a página de erro do site ("Desculpe-nos, houve um erro").\n' +
            'Isso quase sempre é a sessão de busca ou o optionID vencido — eles morrem\n' +
            'junto com o searchSessionID.\n\n' +
            'Refaça a busca do zero, abra o painel de novo e escolha a tarifa outra vez.\n' +
            'NÃO mandei o POST 2 (seria o mesmo erro).');
        return false;
      }

      // Sem pontos suficientes, a booking devolve só o aviso — sem o formulário.
      // Isso é esperado: seguimos com a composição que já temos e mandamos o
      // POST 2 mesmo assim, que é justamente o que faz a tela de cupom abrir.
      if (!rows.length) {
        if (state.paxes.length) {
          state.fareLoaded = true;
          render();
          log('⚠️ o POST 1 não trouxe o formulário' + (aviso ? ' ("' + aviso + '")' : '') +
              '.\nSeguindo com os ' + state.paxes.length + ' pax preenchidos aqui — é o caminho normal quando falta ponto.');
          return true;
        }
        log('❌ o POST 1 não trouxe formulário e eu não tenho composição de passageiros.' +
            (aviso ? '\nA página respondeu: "' + aviso + '"' : '') +
            '\nDefina os passageiros no bloco "Composição" acima.');
        return false;
      }
      // 🔴 As linhas da tela de reserva trazem a idade que o SITE vai cobrar
      // (data-pax-age — o serializer dele manda exatamente isso). Até a v1.6.1
      // elas substituíam os pax do painel sem conferência nenhuma, e o que você
      // tinha digitado ia junto POR POSIÇÃO. Agora: se as idades das crianças
      // não forem as mesmas da busca, para tudo e mostra as duas.
      var doSite = rows.filter(function (p) { return p.type !== '0'; })
                       .map(function (p) { return idadeOuNull(p.age); });
      var doPainel = state.paxes.filter(function (p) { return p.type !== '0'; })
                                .map(function (p) { return idadeOuNull(p.age); });
      state.idadesServidor = doSite;
      // as linhas cruas (tipo/idade/data) vão para o diagnóstico — sem nada pessoal
      state.linhasServidor = rows.map(function (p) {
        return p.type + '/' + (isNaN(p.age) ? '?' : p.age) + '/' + (p.tripDate || '-');
      }).join(' ');
      var painelSabe = state.paxes.length && doPainel.every(function (a) { return a !== null; });
      if (doSite.some(function (a) { return a === null; }) ||
          (painelSabe && !mesmoConjunto(doSite, doPainel))) {
        var comp = state.idadesBusca;
        state.divergencia = 'a tela de reserva do site pediu crianças de ' + txtIdades(doSite) +
          ' ano(s), mas a busca ' + (comp ? '(' + comp.fonte + ') ' : '') + 'é de ' + txtIdades(doPainel) +
          '. Idade diferente da cotada faz o site responder erro. Feche outras abas de busca do site ' +
          '(outra busca na mesma sessão pode ter trocado as idades), refaça a busca do zero e abra o painel de novo.';
        render();
        log('⛔ ' + state.divergencia + '\nNÃO mandei o POST 2. Nada foi criado.');
        return false;
      }
      if (state.paxes.length && rows.length !== state.paxes.length) {
        log('⚠️ a barra de busca dizia ' + state.paxes.length + ' pax, o servidor pediu ' +
            rows.length + '. Vale a do servidor — confira os campos.');
      }
      mergeTyped(rows, state.paxes);
      hydrate(rows);
      rows.forEach(function (p, i) { if (!p.doc) p.doc = PRESET_DOCS[i] || ''; });
      state.paxes = rows;
      state.post1 = { doc: doc, url: r1.url };
      // o que o formulário tem por linha, para o diagnóstico (só nomes e padrões de <select>)
      state.formServidor = descreverFormulario(rows, doc);
      state.fareLoaded = true;
      render();
      if (aviso) log('ℹ️ a página respondeu: "' + aviso + '" — é só render, o POST 2 segue.');
      return true;
    } catch (err) {
      log('❌ ' + err.message);
      return false;
    }
  }

  panel.addEventListener('input', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'uid' || f === 'optionid') {
      state.refs = state.refs || { UID: '', optionID: '', from: 'manual' };
      state.refs[f === 'uid' ? 'UID' : 'optionID'] = e.target.value.trim();
      return;
    }
    if (f.indexOf('m-') === 0) { state.manual[f.slice(2)] = e.target.value; return; }
    var p = state.paxes[+e.target.getAttribute('data-i')];
    if (!p) return;
    if (f === 'x') { p.extra[e.target.getAttribute('data-n')] = e.target.value; return; }
    if (f === 'birthday') {
      var raw = e.target.value;
      if (podeMascarar(raw)) {
        var novo = mascaraData(raw);
        if (novo !== raw) {
          var noFim = e.target.selectionStart === raw.length;
          e.target.value = novo;
          try {
            var caret = noFim ? novo.length : Math.min(e.target.selectionStart, novo.length);
            e.target.setSelectionRange(caret, caret);
          } catch (err) { /* input sem seleção: tudo bem */ }
        }
      }
      p.birthday = e.target.value;
      if (p.status === 'erro') p.status = 'manual';
      return;
    }
    p[f] = f === 'age' ? idadeOuNull(e.target.value) : e.target.value;
    if (p.status === 'erro' && /^(name|surname|birthday)$/.test(f)) p.status = 'manual';
    // documento trocado: o que veio da consulta anterior não vale mais para ele
    if (f === 'doc' && /^(erro|ok|sem doc)$/.test(p.status)) p.status = 'pendente';
  });

  // no blur: 1/1/90, 1990-01-31 e 01.01.1990 viram 01/01/1990
  panel.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'birthday') return;
    var p = state.paxes[+e.target.getAttribute('data-i')];
    if (!p) return;
    var arrumado = normalizarData(e.target.value);
    if (arrumado !== e.target.value) e.target.value = arrumado;
    p.birthday = arrumado;
    if (arrumado && !parseBR(arrumado)) log('⚠️ ' + (p.label || 'pax') + ': "' + arrumado + '" não é uma data válida — use dd/mm/aaaa.');
  }, true);

  panel.addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'pick') {
      var o = listResultOptions()[+e.target.value];
      if (o) {
        state.refs = { UID: o.uid, optionID: o.optionID, hotel: o.hotel + ' · ' + o.label, from: 'escolhida na tela', _cat: o._cat };
        var msg = 'tarifa: ' + o.hotel + ' — ' + o.label;
        if (o._cat) {
          state.checkin = brDate(o._cat.checkin);
          var d = o._cat.dist;
          if (d) {
            var esperado = (d.adults || 0) + (d.children || 0) + (d.babies || 0);
            if (!state.paxes.length) {
              state.paxes = paxesFromDistribution(d);
              state.fareLoaded = true;
            } else if (state.paxes.length !== esperado) {
              msg += '\n⚠️ a busca é para ' + d.adults + ' adulto(s), ' + (d.children || 0) +
                     ' criança(s) e ' + (d.babies || 0) + ' bebê(s) — você tem ' +
                     state.paxes.length + ' pax no painel.';
            }
            state.dist = d;
          }
          if (state.checkin) msg += '\ncheck-in ' + state.checkin + ' (idade dos pax calculada nessa data)';
        }
        render();
        log(msg);
      }
      return;
    }
    if (f === 'uid' || f === 'optionid') return;
    var p = state.paxes[+e.target.getAttribute('data-i')];
    if (!p) return;
    if (f === 'x') { p.extra[e.target.getAttribute('data-n')] = e.target.value; render(); return; }
    p[f] = f === 'age' ? idadeOuNull(e.target.value) : e.target.value;
    if (f === 'age' && recasarCriancasDoPadrao()) render();
  });

  panel.addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (!act) return;
    Promise.resolve(handleClick(act, e)).catch(function (err) {
      console.error('[azul] falha no botão "' + act + '":', err);
      log('❌ erro no botão "' + act + '": ' + (err && err.message || err) +
          '\n(o stack completo está no console)');
    });
  });

  async function handleClick(act, e) {

    if (act === 'close') { panel.remove(); return; }
    if (act === 'min') { state.min = !state.min; render(); return; }
    if (act === 'drag') return;   // tratado no mousedown
    if (act === 'load-fare') { await loadFare(); return; }
    if (act === 'mais-tarifas') {
      if (state.refs && state.refs.UID) await carregarTarifasDoHotel(state.refs.UID);
      return;
    }
    if (act === 'build-manual') { buildManualPaxes(); return; }
    if (act === 'save-preset') { savePreset(); return; }
    if (act === 'clear-preset') { clearPreset(); return; }
    if (act === 'diag') { copiarDiagnostico(); return; }
    if (act === 'lookup') { await doLookup(state.paxes[+e.target.getAttribute('data-i')]); return; }

    if (act === 'lookup-all') {
      if (state.consultando > 0) { log('⏳ já estou consultando — espere terminar.'); return; }
      log('consultando…');
      var lista = state.paxes.slice();
      for (var i = 0; i < lista.length; i++) { await doLookup(lista[i]); await sleep(400); }
      var pr = problemas(), av = avisos();
      log(pr.length
        ? '⚠️ antes de continuar, falta acertar:\n• ' + pr.join('\n• ') + (av.length ? '\n\nℹ️ ' + av.join('\nℹ️ ') : '')
        : '✅ tudo pronto — pode continuar.' + (av.length ? '\n\nℹ️ ' + av.join('\nℹ️ ') : ''));
      return;
    }

    if (act === 'dry' || act === 'send') {
      // fora do modo formulário, o POST 1 tem que acontecer imediatamente antes
      // do POST 2 — é ele que deixa a tarifa selecionada na sessão
      if (state.mode !== 'form') {
        if (!state.refs || !state.refs.UID || !state.refs.optionID) {
          state.faltaTarifa = true;
          render();
          log('❌ escolha o hotel e a tarifa no dropdown antes de simular/reservar.');
          return;
        }
        state.faltaTarifa = false;
      }

      // 🔴 confere ANTES do POST 1: se já se sabe que vai dar errado, não gasta
      // nem a seleção da tarifa. A divergência com a tela de reserva é refeita
      // a cada tentativa (o POST 1 abaixo confere de novo).
      state.divergencia = '';
      state.ultimoBloqueio = null;
      var antes = problemas();
      if (antes.length) { bloquear(antes, 'antes do POST 1'); return; }

      if (state.mode !== 'form') {
        // 🔴 NÃO chamar results.ashx aqui. Ele re-roda a busca na sessão e
        // invalida o optionID que estamos segurando — foi o que quebrou a
        // reserva em 15/08. A sequência boa é POST 1 e POST 2 colados, sem
        // nenhuma outra chamada no meio.
        log('POST 1 — selecionando a tarifa…');
        if (!await loadFare()) {
          if (state.divergencia) state.ultimoBloqueio = [state.divergencia];
          return;
        }
        // as linhas da tela de reserva podem ter mudado os pax: confere de novo
        var depois = problemas();
        if (depois.length) { bloquear(depois, 'depois do POST 1 — o POST 2 não foi'); return; }
      }

      var w2 = avisos();
      state.paxes.forEach(applyPax);              // no-op no modo sem form
      var params;
      try { params = buildParams(state); }
      catch (err) { log('❌ ' + err.message); return; }

      console.log('%c[azul] payload', 'color:#48bb78', params);
      console.log('%c[azul] bookingPaxes', 'color:#48bb78', JSON.parse(params.bookingPaxes));

      if (act === 'dry') {
        var bp = JSON.parse(params.bookingPaxes);
        var nPax = bp.reduce(function (n, r) { return n + r.paxes.length; }, 0);
        var resumoSim =
          '✅ SIMULAÇÃO OK — nada foi enviado.\n' +
          'tarifa: ' + (state.refs.hotel || state.refs.UID) + '\n' +
          'passageiros: ' + nPax + ' → ' +
            bp[0].paxes.map(function (p) { return p.name + ' (' + p.paxAge + ')'; }).join(', ') + '\n' +
          'payload: ' + params.bookingPaxes.length + ' bytes · campos: ' + Object.keys(params).join(', ') +
          (w2.length ? '\n\n⚠️ ' + w2.join('\n⚠️ ') : '');
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(params, null, 2));
        } catch (err) { /* clipboard é opcional */ }
        log(resumoSim);
        return;
      }

      var resumo = state.paxes.map(function (p) {
        return '• ' + p.name + ' ' + p.surname + ' (' + p.birthday + ')';
      }).join('\n');

      // A booking.aspx é pulada — e é lá que ficam as políticas do hotel.
      var cat = state.refs && state.refs._cat;
      var politica =
        '\n\nNada é reservado agora. Você vai para a tela de confirmação, onde\n' +
        'aplica o cupom e decide se finaliza.\n\n' +
        '⚠️ No caminho normal do site existe uma página que mostra as políticas\n' +
        'do hotel — cancelamento, horário de check-in e check-out, taxas cobradas\n' +
        'no destino. Este atalho não passa por ela, então essas regras não vão\n' +
        'aparecer para você.' +
        (cat && cat.semReemb ? '\n\n🔴 Esta tarifa está marcada como NÃO REEMBOLSÁVEL.' : '') +
        '\n\nConfira as condições na tela de confirmação antes de finalizar o resgate.';

      if (!confirm('Ir para a tela de confirmação?\n\n' + resumo +
                   (w2.length ? '\n\nAvisos:\n' + w2.join('\n') : '') +
                   politica)) { log('cancelado.'); return; }
      log('enviando…');
      await submitBooking(state, params);
    }
  }

  // A lista de resultados é re-renderizada pelo site a cada filtro, ordenação
  // ou paginação. Sem isto o dropdown congelava na primeira leitura.
  var reobservar = null;
  function observarResultados() {
    if (!window.MutationObserver) return;
    // 🔴 nunca observar o body: o painel vive dentro dele, então render()
    // dispararia o observer, que chamaria render() — loop infinito.
    var alvo = document.querySelector('.js-results-list-placeholder, .results-list__body, .results-list') ||
               document.querySelector('[class*="results-list"], [class*="result-list"]') ||
               ($('.result[data-uid]').first().parent()[0]) ||
               null;
    if (!alvo || alvo === document.body || (panel && alvo.contains(panel))) {
      state.observando = false;
      return;
    }
    state.observando = true;

    var timer = null;
    var obs = new MutationObserver(function (muts) {
      // mutação nossa (o painel) não conta
      var soNossa = muts.every(function (m) { return panel && panel.contains(m.target); });
      if (soNossa) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (state.min) return;                       // painel fechado, não mexe
        var antes = state.refs && state.refs.optionID;
        // A lista mudou: o site pode ter carregado mais hotéis (scroll infinito)
        // ou trocado o filtro. Relemos a memória DELE — de graça, sem pedir nada
        // ao servidor. Era isto que a v1.4.x fazia com uma enxurrada de POSTs.
        if (state.catalogFonte === 'memória do site') {
          var novo = catalogoDoCacheDoSite();
          if (novo && novo.length !== (state.catalog || []).length) {
            state.catalog = novo;
            log('a lista da tela mudou: agora são ' + novo.length + ' tarifa(s) no dropdown.');
          }
        }
        render();                                    // reordena pelo DOM novo
        if (antes) {
          var ainda = listResultOptions().some(function (o) {
            return o.optionID === antes && o._naTela;
          });
          if (!ainda) {
            log('ℹ️ a lista da tela mudou e a tarifa que você escolheu não está mais visível.\n' +
                'Ela continua selecionada — se não for a que você quer, escolha de novo.');
          }
        }
      }, 400);
    });
    obs.observe(alvo, { childList: true, subtree: true });
    reobservar = obs;
  }
  observarResultados();

  // arrastar pelo cabeçalho
  panel.addEventListener('mousedown', function (e) {
    if (e.target.getAttribute('data-act') !== 'drag') return;
    var r = panel.getBoundingClientRect();
    var dx = e.clientX - r.left, dy = e.clientY - r.top;
    function move(ev) {
      panel.style.left = Math.max(0, ev.clientX - dx) + 'px';
      panel.style.top = Math.max(0, ev.clientY - dy) + 'px';
      panel.style.right = 'auto';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  // catálogo: memória do site primeiro, results.ashx só se ela não existir
  if (state.mode !== 'form') {
    loadCatalog().then(function (cat) {
      if (!cat) {
        // 🔴 se a proteção cortou, o aviso dela já está no log e é o que
        // importa — não sobrescrever com um recado genérico.
        if (!state.bloqueado) log('não consegui ler o catálogo — usando as tarifas visíveis na tela.');
        return;
      }
      state.catalog = cat;
      state.dist = state.dist || cat[0].dist || null;
      if (!state.paxes.length && cat[0].dist) {
        state.paxes = paxesFromDistribution(cat[0].dist);
        state.fareLoaded = state.paxes.length > 0;
      }
      state.checkin = state.checkin || brDate(cat[0].checkin);
      render();
      var d = cat[0].dist || {};
      var hoteis = {};
      cat.forEach(function (c) { hoteis[c.uid] = 1; });
      log('catálogo (' + (state.catalogFonte || '?') + '): ' + cat.length + ' tarifa(s) em ' +
          Object.keys(hoteis).length + ' hotel(is) · busca para ' +
          (d.adults || 0) + ' adulto(s), ' + (d.children || 0) + ' criança(s), ' +
          (d.babies || 0) + ' bebê(s)' + (state.checkin ? ' · check-in ' + state.checkin : '') + '.\n' +
          resumoPreset());
    }).catch(function (e) { log('falha lendo o catálogo: ' + e.message); });
  }

  // OneTrust primeiro: o clique dele pode remover a tarja da página, e aí o
  // fallback genérico do aceitarPeloSite não teria o que clicar.
  var ot = aceitarOneTrust();
  state.oneTrust = ot;

  var ckLimpo = limparCookieDuplicado();
  var ckFix;
  if (ckLimpo.tinha > 1) {
    ckFix = { ok: false, motivo: 'duplicata removida', via: '' };
  } else if (aceitarPeloSite()) {
    ckFix = { ok: true, via: 'botão do site' };
  } else {
    ckFix = fixarAceite();
    ckFix.via = 'gravado pelo painel';
  }
  var tarjas = esconderTarjaCookies();

  render();
  log(state.mode === 'form'
    ? 'Formulário encontrado: ' + state.paxes.length + ' pax.'
    : state.mode === 'results'
      ? 'Composição lida da barra de busca: ' + state.paxes.length + ' pax' +
        (state.idadesBusca && state.idadesBusca.idades.length
          ? (state.idadesBusca.conflito
              ? ' — ⚠️ as fontes da página divergem nas idades das crianças; informe-as abaixo'
              : ' — crianças com ' + txtIdades(state.idadesBusca.idades) + ' ano(s) (' + state.idadesBusca.fonte + ')')
          : '') +
        '. Escolha o hotel/tarifa, preencha os CPFs e clique em Continuar.'
      : 'Sem formulário nesta página — modo dois POSTs. ' +
        (state.refs ? 'Tarifa detectada, é só carregar.' : 'Escolha/cole a tarifa (UID + optionID).'));

  if (ot.achou && ot.clicou && ot.gravou && !ot.jaTinha) {
    state.cookieAviso = 'aceitei a tarja do OneTrust';
  } else if (ot.achou && ot.clicou && !ot.gravou) {
    // o clique saiu mas o SDK não gravou: costuma ser bloqueio de rede no
    // geolocation.onetrust.com (pi-hole/DNS/extensão). Escondida, mas volta.
    state.cookieAviso = 'OneTrust não gravou o aceite — só escondi';
  } else if (ckLimpo.tinha > 1) {
    state.cookieAviso = 'cookie duplicado removido';
  } else if (ckFix.ok) {
    state.cookieAviso = 'aceite de cookies válido (' + ckFix.via + ')';
  } else if (tarjas) {
    state.cookieAviso = tarjas + ' tarja(s) escondida(s)';
  } else if ((document.cookie.match(/accept-cookies=/g) || []).length) {
    state.cookieAviso = 'cookie de aceite presente';
  }
  if (state.cookieAviso) render();

  window.__azulPax = {
    version: VERSION,
    preset: loadPreset,
    limparCookieDuplicado: limparCookieDuplicado,
    fixarAceite: fixarAceite,
    aceitarPeloSite: aceitarPeloSite,
    aceitarOneTrust: aceitarOneTrust,
    normalizarData: normalizarData,
    mascaraData: mascaraData,
    esconderTarjaCookies: esconderTarjaCookies,
    resumoPreset: resumoPreset,
    diagnostico: copiarDiagnostico,
    problemas: problemas,
    avisos: avisos,
    lerComposicaoDaBusca: lerComposicaoDaBusca,
    fonteUrl: fonteUrl,
    simular: function () { return handleClick('dry'); },
    reservar: function () { return handleClick('send'); },
    state: state, lookup: lookup, buildParams: function () { return buildParams(state); },
    serializarPaxesComoSite: serializarPaxesComoSite, getFormParamsComoSite: getFormParamsComoSite,
    preencherLinha: preencherLinha, readPaxRows: readPaxRows, classifyBooking: classifyBooking,
    apply: function () { state.paxes.forEach(applyPax); },
    detectRefs: detectRefs, listResultOptions: listResultOptions, loadFare: loadFare
  };
})();
