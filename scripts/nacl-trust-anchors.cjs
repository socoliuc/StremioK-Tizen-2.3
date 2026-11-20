// Public trust roots from the installed Node runtime; no credentials involved.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), tls = require('tls');
const forge = require('node-forge');
let out = '/* Generated public CA trust anchors from Node tls.rootCertificates. */\n', entries=[];
function bytes(name, b) {out += 'static unsigned char '+name+'[] = {'+Array.from(b,v=>'0x'+v.toString(16).padStart(2,'0')).join(',')+'};\n';return name;}
for (const pem of tls.rootCertificates) {
  const cert = new crypto.X509Certificate(pem), key = cert.publicKey.export({format:'jwk'}), i=entries.length;
  if (!['RSA','EC'].includes(key.kty)) continue;
  const curve = { 'P-256':23, 'P-384':24, 'P-521':25 }[key.crv];
  if (key.kty === 'EC' && !curve) continue;
  const fields = forge.asn1.fromDer(cert.raw.toString('binary')).value[0].value;
  const subject = fields[(fields[0].tagClass===128 ? 1 : 0)+4];
  const dn=bytes('ca_dn_'+i,Buffer.from(forge.asn1.toDer(subject).getBytes(),'binary'));
  let pkey;
  if(key.kty==='RSA') {
    const n=bytes('ca_n_'+i,Buffer.from(key.n,'base64url')),e=bytes('ca_e_'+i,Buffer.from(key.e,'base64url'));
    pkey='{BR_KEYTYPE_RSA,{.rsa={'+n+',sizeof('+n+'),'+e+',sizeof('+e+')}}}';
  } else {
    const q=bytes('ca_q_'+i,Buffer.concat([Buffer.from([4]),Buffer.from(key.x,'base64url'),Buffer.from(key.y,'base64url')]));
    pkey='{BR_KEYTYPE_EC,{.ec={'+curve+','+q+',sizeof('+q+')}}}';
  }
  entries.push('{{'+dn+',sizeof('+dn+')},BR_X509_TA_CA,'+pkey+'}');
}
out += 'static const br_x509_trust_anchor trust_anchors[] = {\n'+entries.join(',\n')+'\n};\n';
fs.writeFileSync(path.resolve(__dirname,'../native/trust-anchors.h'),out);
console.log('Generated public trust roots: '+entries.length);
