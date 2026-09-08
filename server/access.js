const { openAccess } = require("./auth");
const access = openAccess();
try {
  const [action = "list", code] = process.argv.slice(2);
  if (action === "list") console.table(access.requests());
  else if (["approve", "deny"].includes(action) && code) {
    access.decide(code, action === "approve", "local-console");
    console.log(action === "approve" ? "기기를 승인했습니다." : "요청을 거절했습니다.");
  } else throw new Error("사용법: npm run access -- list | approve 승인코드 | deny 승인코드");
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { access.close(); }
