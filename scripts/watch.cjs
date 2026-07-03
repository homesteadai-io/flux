const { getCleanTranscript } = require('./transcript.cjs');

async function main() {
  const url = process.argv.slice(2).join(' ').trim();
  const result = await getCleanTranscript(url);

  if (result.ok) {
    process.stdout.write(`${result.transcript}\n`);
    return;
  }

  process.stderr.write(`${result.message}\n`);
  process.exitCode = result.reason === 'NO_CAPTIONS' ? 2 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
