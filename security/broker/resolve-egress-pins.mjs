// Operator-side setup only. Never run inside the untrusted learning app.
import dns from 'node:dns/promises';
import {publicAddress} from './egress.mjs';
const pins={};
for(const [key,host] of [['LH_AUTH_IPV4','auth.openai.com'],['LH_API_IPV4','api.openai.com']]){
 const addresses=await dns.resolve4(host);
 if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error('Non-public provider address rejected');
 pins[key]=addresses[0];
}
console.log(JSON.stringify(pins));
