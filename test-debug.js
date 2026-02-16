var Srp = require('./lib/srp.js');
var BigInt = require('big-integer');
var crypto = require('crypto');

const USER = 'SYSDBA';
const PASSWORD = 'masterkey';

// Run many iterations to find a failing case
for (let i = 0; i < 1000; i++) {
    const salt = crypto.randomBytes(32).toString('hex');
    
    var clientKeys = Srp.clientSeed();
    var serverKeys = Srp.serverSeed(USER, PASSWORD, salt);

    const serverSessionKey = Srp.serverSession(
      USER, PASSWORD, salt,
      clientKeys.public, serverKeys.public, serverKeys.private
    );

    const proof = Srp.clientProof(
      USER, PASSWORD, salt,
      clientKeys.public, serverKeys.public, clientKeys.private,
      'sha1'
    );

    if (!proof.clientSessionKey.equals(serverSessionKey)) {
        console.log('FAILURE at iteration', i);
        console.log('Client session key:', proof.clientSessionKey.toString(16));
        console.log('Server session key:', serverSessionKey.toString(16));
        console.log('Salt:', salt);
        console.log('Client private (a):', clientKeys.private.toString(16));
        console.log('Client public (A):', clientKeys.public.toString(16));
        console.log('Server private (b):', serverKeys.private.toString(16));
        console.log('Server public (B):', serverKeys.public.toString(16));
        
        // Check if a + u*x would exceed N
        var u = BigInt(require('crypto').createHash('sha1').update(Buffer.concat([
            Srp.hexPad(clientKeys.public.toString(16)),
            Srp.hexPad(serverKeys.public.toString(16))
        ].map(h => Buffer.from(h, 'hex')))).digest('hex'), 16);
        
        console.log('u:', u.toString(16));
        break;
    }
}

console.log('Done');
