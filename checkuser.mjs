import bcrypt from 'bcrypt';

const storedHash = '$2a$12$JRi8.V0c.AOo7g5y0gbZPeHeQIgGZYmFA9bmHdMDdrWpLDbIk2FNS';

const attempts = [
  'Bros Jay7',
  'Bros Jay7 ',
  ' Bros Jay7',
  'brosjay7',
  'BrosJay7',
  'Bros jay7',
  'bros jay7',
  'Bros Jay 7',
];

for (const p of attempts) {
  const match = await bcrypt.compare(p, storedHash);
  console.log(`"${p}" → ${match ? '✅ MATCH' : '❌ no'}`);
}