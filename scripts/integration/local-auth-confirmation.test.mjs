import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmationEnvironment} from './local-auth-confirmation.mjs';
import * as registration from '../internal-ui/registration-journey.mjs';
test('default fixture preserves auto-confirm for existing local journeys',()=>{
 assert.deepEqual(confirmationEnvironment(false),{GOTRUE_MAILER_AUTOCONFIRM:'true'});
});
test('explicit confirmation uses native private Postgres hook and six digits',()=>{
 const config=confirmationEnvironment(true);
 assert.equal(config.GOTRUE_MAILER_AUTOCONFIRM,'false');
 assert.equal(config.GOTRUE_HOOK_SEND_EMAIL_ENABLED,'true');
 assert.equal(config.GOTRUE_HOOK_SEND_EMAIL_URI,'pg-functions://postgres/local_auth_fixture/capture_email');
 assert.equal(config.GOTRUE_MAILER_OTP_LENGTH,'6');
});
test('nonboolean confirmation mode fails before any runtime side effect',()=>{
 for(const value of ['false','true',1,0,null,{},undefined])assert.throws(()=>confirmationEnvironment(value),/LOCAL_CONFIRMATION_BOOLEAN_REQUIRED/);
});
test('registration errors redact browser signup passwords and native credentials',()=>{
 assert.equal(typeof registration.redactRegistrationOutput,'function');
 const redact=registration.redactRegistrationOutput;
 const stack={redact:value=>String(value).replaceAll('native-fixture-key','[NATIVE_REDACTED]')};
 assert.equal(redact('fill("synthetic-password-value"); native-fixture-key',stack,['synthetic-password-value']),'fill("[LOCAL_CREDENTIAL_REDACTED]"); [NATIVE_REDACTED]');
});
