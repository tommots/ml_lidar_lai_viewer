const TABLES = {
  viridis: '44015444025645045745055946075a46085c460a5d460b5e470d60470e6147106347116447136548146748166848176948186a481a6c481b6d481c6e481d6f481f70482071482173482374482475482576482677482878482979472a7a472c7a472d7b472e7c472f7d46307e46327e46337f463480453581453781453882443983443a83443b84433d84433e85423f854240864241864142874144874045884046883f47883f48893e49893e4a893e4c8a3d4d8a3d4e8a3c4f8a3c508b3b518b3b528b3a538b3a548c39558c39568c38588c38598c375a8c375b8d365c8d365d8d355e8d355f8d34608d34618d33628d33638d32648e32658e31668e31678e31688e30698e306a8e2f6b8e2f6c8e2e6d8e2e6e8e2e6f8e2d708e2d718e2c718e2c728e2c738e2b748e2b758e2a768e2a778e2a788e29798e297a8e297b8e287c8e287d8e277e8e277f8e27808e26818e26828e26828e25838e25848e25858e24868e24878e23888e23898e238a8d228b8d228c8d228d8d218e8d218f8d21908d21918c20928c20928c20938c1f948c1f958b1f968b1f978b1f988b1f998a1f9a8a1e9b8a1e9c891e9d891f9e891f9f881fa0881fa1881fa1871fa28720a38620a48621a58521a68522a78522a88423a98324aa8325ab8225ac8226ad8127ad8128ae8029af7f2ab07f2cb17e2db27d2eb37c2fb47c31b57b32b67a34b67935b77937b87838b9773aba763bbb753dbc743fbc7340bd7242be7144bf7046c06f48c16e4ac16d4cc26c4ec36b50c46a52c56954c56856c66758c7655ac8645cc8635ec96260ca6063cb5f65cb5e67cc5c69cd5b6ccd5a6ece5870cf5773d05675d05477d1537ad1517cd2507fd34e81d34d84d44b86d54989d5488bd6468ed64590d74393d74195d84098d83e9bd93c9dd93ba0da39a2da37a5db36a8db34aadc32addc30b0dd2fb2dd2db5de2bb8de29bade28bddf26c0df25c2df23c5e021c8e020cae11fcde11dd0e11cd2e21bd5e21ad8e219dae319dde318dfe318e2e418e5e419e7e419eae51aece51befe51cf1e51df4e61ef6e620f8e621fbe723fde725',
  rdbu: '05306106326407346708366a09386d0a3b700c3d730d3f760e41790f437b10457e114781124984134c87144e8a15508d1752901854931956961a58991b5a9c1c5c9f1d5fa21e61a51f63a82065ab2267ac2369ad246aae266caf276eb02870b12a71b22b73b32c75b42e77b52f79b5307ab6327cb7337eb83480b93681ba3783bb3885bc3a87bd3b88be3c8abe3e8cbf3f8ec0408fc14291c24393c34695c44997c54c99c64f9bc7529dc8569fc959a1ca5ca3cb5fa5cd62a7ce65a9cf68abd06bacd16eaed271b0d375b2d478b4d57bb6d67eb8d781bad884bcd987beda8ac0db8dc2dc90c4dd93c6de96c7df98c8e09bc9e09dcbe1a0cce2a2cde3a5cee3a7d0e4a9d1e5acd2e5aed3e6b1d5e7b3d6e8b6d7e8b8d8e9bbdaeabddbeac0dcebc2ddecc5dfecc7e0edcae1eecce2efcfe4efd1e5f0d2e6f0d4e6f1d5e7f1d7e8f1d8e9f1dae9f2dbeaf2ddebf2deebf2e0ecf3e1edf3e3edf3e4eef4e6eff4e7f0f4e9f0f4eaf1f5ecf2f5edf2f5eff3f5f0f4f6f2f5f6f3f5f6f5f6f7f6f7f7f7f6f6f7f5f4f8f4f2f8f3f0f8f2eff8f1edf9f0ebf9efe9f9eee7f9ede5f9ebe3faeae1fae9dffae8defae7dcfbe6dafbe5d8fbe4d6fbe3d4fce2d2fce0d0fcdfcffcdecdfdddcbfddcc9fddbc7fdd9c4fcd7c2fcd5bffcd3bcfbd0b9fbceb7fbccb4facab1fac8aff9c6acf9c4a9f9c2a7f8bfa4f8bda1f8bb9ef7b99cf7b799f7b596f6b394f6b191f6af8ef5ac8bf5aa89f5a886f4a683f3a481f2a17ff19e7df09c7bef9979ee9677ec9374eb9172ea8e70e98b6ee8896ce6866ae58368e48066e37e64e27b62e17860df765ede735cdd7059dc6e57db6b55da6853d86551d7634fd6604dd55d4cd35a4ad25849d05548cf5246ce4f45cc4c44cb4942c94741c84440c6413ec53e3dc43b3cc2383ac13639bf3338be3036bd2d35bb2a34ba2832b82531b72230b61f2eb41c2db3192cb1182bae172aab162aa81529a51429a213289f12289c1127991027960f27930e26900d268d0c258a0b25870a248409248108237f08237c07227906227605217304217003206d02206a011f67001f',
  rdbu_dark: '82c5fe80c4fc7bc3fe7ac2fd79c0fc74bffe72befd6dbdff6bbcfe6abbfc64baff63b9fe61b7fc60b6fb5fb5fa5eb4f85db2f75bb1f65ab0f559aff358aef256acf155abef55aaed55a9ec54a8ea54a6e853a5e653a4e552a3e352a2e152a0df519fdd519edc509dda509bd84f9ad64f99d44e98d34e97d14e95cf4d94cd4d93cc4c92ca4c91c84c8fc64b8ec44b8dc34a8cc14a8bbf498abd4988bb4987ba4886b84885b64784b44782b34781b14680af467fad457eab457caa457ba8447aa64479a44378a34377a143759f42749d42739c41729a417198417096406e94406d933f6c913f6b8f3f6a8d3e698c3e678a3d66883d65863d64853c63833c62813b607f3b5f7d3b5e7c3a5d7a3a5c783a5b7639597539587338577138566f38556d37546c37526a375168365066364f64354e63354d61354c5f344a5d34495b34485a33475833465633455432435232425032414f31404d313f4b303d49303c47303b45303a432f39412f383f2f363d2e353b2e34392e33372e31352d30322d2f30302e2e332f2e352f2e38302e3a312e3c312f3e322f4033304233304434304635314836314a36324c37324e3833503833523933543a34563b34583b355a3c355b3d365d3d365f3e37613f376340386540386741396842396a423a6c433a6e443b70453b71453c73463c75473d77483d79483e7a493e7c4a3f7e4a3f804b40824c40834d41854d41874e42894f438b50438c50448e51449052459253459353469554469755479956479b56489c57489e5849a0594aa2594aa45a4ba55b4ba75c4ca95c4cab5d4dac5e4dae5f4eb0604fb2604fb46150b56250b76351b96351bb6452bd6553be6653c06754c26754c46855c56955c76a56c96a57cb6b57cd6c58ce6d58d06e59d26e5ad46f5ad6705bd7715bd9725cdb725ddd735ddf745ee0755ee2765fe47660e67760e87861e97961eb7a62ed7a63ef7b63f17c64f27d64f47e65f57f66f78068f88169f9836afb846bfc856cfd866dff876efc8b73fe8c74ff8d75fd917afe927bfc957ffe9780ff9882fd9b86fe9c87fd9f8bfea08cfca390',
  white_greens: 'fffffffefffefdfefdfcfefcfcfefbfbfdfafafdf9f9fdf8f8fcf7f7fcf6f6fcf5f5fbf4f5fbf3f4fbf2f3faf1f2faf0f1faeff0f9eeeff9edeef9eceef8ebedf8eaecf8e9ebf7e8eaf7e7e9f7e6e8f6e4e7f6e3e7f6e2e6f5e1e5f5e0e4f5dfe3f4dee2f4dde1f4dce0f3dbe0f3dadff2d9def2d8ddf2d7dcf1d6dbf1d5daf0d4d9f0d3d8f0d2d7efd1d6efd0d5eecfd4eeced3eecdd2edccd1edcbd0eccacfecc9ceecc8cdebc7ccebc6cbeac5caeac3c9e9c2c8e9c1c7e9c0c6e8bfc5e8bec4e7bdc3e7bcc2e7bbc1e6bac0e6b9bfe5b8bee5b7bde5b6bce4b5bbe4b4b9e3b3b8e3b2b7e2b0b6e2afb4e1aeb3e0adb2e0acb0dfabafdfaaaedea8addea7abdda6aadda5a9dca4a8dba3a6dba2a5daa0a4da9fa3d99ea1d99da0d89c9fd89b9ed79a9cd6989bd6979ad59698d59597d49496d49395d39293d29092d28f91d18e90d18d8ed08c8dd08b8ccf8a8ace8989ce8887cd8785cc8684cb8582cb8481ca837fc9827ec8817cc8807bc77f79c67e78c57d76c57c75c47b73c37a72c27970c2786ec1776dc0766bc0756abf7468be7367bd7265bd7164bc7062bb6f61ba6e5fba6d5eb96c5cb86b5bb76a59b76957b66856b56754b46653b46652b36551b26450b1634fb0634eaf624cae614bad604aac6049ab5f48aa5e47a95d45a95d44a85c43a75b42a65a41a55a40a4593fa3583da2573ca1573ba0563a9f55399e54389e54369d53359c52349b51339a5132995031984f30974e2e964e2d954d2c944c2b934b2a924b29924a289149279048268f47258e47248d46238c45218b44208a441f89431e88421d87411c86411b85401a843f19833e18823d17813d16813c15803b147f3a137e3a127d39117c38107b370f7a370e79360c78350b77340a763409753308743207733106723005713004702f046f2e046e2e046d2d046b2d046a2c04692c04682b03662b03652a036429036329036228036028035f27035e27025d26025b26025a25025924025824025623025523025422015322015221015021014f20014e1f014d1f014b1e014a1e00491d00481d00461c00451c00441b',
  batlow: '011959011b59011c5a011e5a011f5a01215a01225b01245b01255b01275b02285c02295c022b5c032c5c032e5c042f5d04305d05325d06335d07345d07355e08375e09385e0a395e0b3b5e0c3c5e0e3d5f0f3e5f10405f10415f11425f11425f114360124460124560134660134760134860144960144a60154b60154c61164d61164e61174e61174f611850611851611952611953611a54611a55621b56621b57621c58621c58621d59621d5a621f5b62205c61215c61225d60235e60255e60265f5f27605f28605f29615e2a625e2b625d2c635d2d645d2e645c30655c31665b32665b33675a34685a356859366959376a58386a58396b583a6c573b6c573c6d563e6e553f6e55416f54436f534470534670524871514971504b72504d724f4e734e50734d51744c53744c54754b56754a5776495976485a77475c77465d78465f7845607844627943637942657a41667a3f687b3e697b3e6b7c3d6d7c3d6f7d3c717d3c737e3b757e3b777f3a797f3a7b80397c80397e81388081378282378482368683358883358984348b84338d85338f853291863193863094872f96872e98882e9a882d9c892c9e892ba08a2ca18a2da38a2ea58b2fa78b30a98b31ab8c31ad8c32af8d33b08d34b28d35b48e36b68e37b88e37ba8f38bc8f39be8f3abf903bc1903cc3903cc5913dc7913ec9913fcb9240cc9241ce9241d09342d29343d39445d59448d6954ad7954cd9964eda9650db9752dd9754de9856df9858e1995ae2995ce39a5ee59a60e69b62e79b64e99c66ea9c68eb9d6aed9d6cee9d6eef9e6ff19e71f29f73f39f75f5a077f6a079f8a17af8a27df8a27ff8a381f9a484f9a586f9a689f9a68bf9a78dfaa890faa992faaa94faaa97faab99faac9bfbad9efbada0fbaea2fbafa4fbb0a7fcb0a9fcb1abfcb2adfcb3affcb4b2fcb4b4fdb5b6fdb6b8fdb7bbfdb7bdfdb8bffdb9c1fdbac3fdbac6fdbbc8fcbccafcbdccfcbdcefcbed1fcbfd3fcc0d5fcc0d7fcc1d9fcc2dcfcc3defbc3e0fbc4e2fbc5e4fbc6e6fbc6e9fbc7ebfbc8edfbc8effbc9f1facaf3facbf6facbf8faccfa',
};

const FADING = {
  fade_greens: { table: 'white_greens', canvas: [0xff, 0xff, 0xff] },
  fade_greens_dark: { table: 'white_greens', canvas: [0x0a, 0x0e, 0x12] },
};

const FADE_GAMMA = 0.6;

const DECODED = {};

function table(name) {
  let t = DECODED[name];
  if (!t) {
    t = new Float32Array(256 * 3);
    if (fades(name)) {
      const rgb = [0, 0, 0];
      for (let i = 0; i < 256; i++) t.set(sample(FADING[name].table, (i / 255) ** FADE_GAMMA, rgb), i * 3);
    } else {
      const hex = TABLES[name];
      if (!hex) throw new Error(`unknown color map ${name}`);
      for (let i = 0; i < 256 * 3; i++) t[i] = parseInt(hex.substr(i * 2, 2), 16) / 255;
    }
    DECODED[name] = t;
  }
  return t;
}

export const MAP_LABELS = {
  viridis: 'viridis', white_greens: 'white–green', fade_greens: 'fading green',
  fade_greens_dark: 'fading green', rdbu: 'blue–white–red (diverging)',
  rdbu_dark: 'blue–dark–red (diverging)', batlow: 'batlow-like',
};

export const LAI_MAPS = ['fade_greens', 'viridis'];

const FADE_END = 0.5;

export function laiTableFor(map, theme) {
  if (map === 'fade_greens') return theme === 'light' ? 'fade_greens' : 'fade_greens_dark';
  return map;
}

export function fades(name) {
  return Object.prototype.hasOwnProperty.call(FADING, name);
}

export function fadeAlpha(t) {
  const u = Math.min(1, Math.max(0, (Number.isFinite(t) ? t : 0) / FADE_END));
  return 1 - (1 - u) ** 3;
}

export function errorMapFor(theme) {
  return theme === 'light' ? 'rdbu' : 'rdbu_dark';
}

export function laiRampRange(theme) {
  return theme === 'light' ? [0, 1] : [0.08, 1];
}

export function laiMapRange(map, theme) {
  return map === 'viridis' ? laiRampRange(theme) : [0, 1];
}

export const OKABE_ITO = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];

export function sample(name, t, out = [0, 0, 0]) {
  const tb = table(name);
  let x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  x *= 255;
  const i = Math.min(254, Math.floor(x));
  const f = x - i;
  for (let c = 0; c < 3; c++) out[c] = tb[i * 3 + c] * (1 - f) + tb[(i + 1) * 3 + c] * f;
  return out;
}

export function seen(name, t, out = [0, 0, 0]) {
  sample(name, t, out);
  if (fades(name)) {
    const bg = FADING[name].canvas;
    const a = fadeAlpha(t);
    for (let c = 0; c < 3; c++) out[c] = (bg[c] / 255) * (1 - a) + out[c] * a;
  }
  return out;
}

export function sampleHex(name, t) {
  return rgbToHex(seen(name, t));
}

export function cssGradient(name, from = 0, to = 1, stops = 12, direction = 'to right') {
  const parts = [];
  for (let i = 0; i < stops; i++) {
    const u = i / (stops - 1);
    parts.push(`${sampleHex(name, from + (to - from) * u)} ${(u * 100).toFixed(1)}%`);
  }
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0.6, 0.6, 0.6];
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255);
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

export function luminance(rgb) {
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function inkOn(rgb) {
  return luminance(rgb) > 0.179 ? '#000000' : '#ffffff';
}

export function categoryColors(attr) {
  const out = new Map();
  const codes = Object.keys(attr.categories || {}).map(Number).sort((a, b) => a - b);
  let slot = 0;
  for (const code of codes) {
    const given = attr.colors && attr.colors[String(code)];
    if (given) out.set(code, given);
    else {
      out.set(code, slot < OKABE_ITO.length ? OKABE_ITO[slot] : goldenHue(slot));
      slot += 1;
    }
  }
  return out;
}

function goldenHue(i) {
  const h = (i * 137.508) % 360;
  return `hsl(${h.toFixed(0)}, 55%, 58%)`;
}

export function pointRampRange(theme) {
  return theme === 'light' ? [0.0, 0.86] : [0.14, 1.0];
}
