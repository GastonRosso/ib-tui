import { execSync } from "child_process";
import readlineSync from "readline-sync";

type Credentials = { username: string; password: string };

function getCredentialsFrom1Password(): Credentials | null {
  try {
    console.log("Fetching credentials from 1Password...");
    const username = execSync(
      'op item get "Interactivebrokers" --fields username',
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    const password = execSync(
      'op item get "Interactivebrokers" --fields password --reveal',
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();

    if (username && password) {
      console.log("Credentials loaded from 1Password.");
      return { username, password };
    }
    return null;
  } catch {
    return null;
  }
}

function getCredentialsFromPrompt(): Credentials {
  const username = readlineSync.question("IBKR Username: ");
  const password = readlineSync.question("IBKR Password: ", {
    hideEchoBack: true,
  });
  return { username, password };
}

function main() {
  console.log("Start IB Gateway\n");

  let credentials = getCredentialsFrom1Password();

  if (!credentials) {
    console.log("1Password not available, falling back to manual input.\n");
    credentials = getCredentialsFromPrompt();
  }

  const { username, password } = credentials;

  if (!username || !password) {
    console.error("Username and password are required");
    process.exit(1);
  }

  console.log("\nStarting IB Gateway...");

  execSync("docker compose up -d", {
    stdio: "inherit",
    env: {
      ...process.env,
      IBKR_USERNAME: username,
      IBKR_PASSWORD: password,
    },
  });

  console.log("\nIB Gateway started.");
  console.log("API port: 4001");
  console.log("Opening VNC viewer...");

  execSync("open vnc://localhost:5900", { stdio: "inherit" });
}

main();
