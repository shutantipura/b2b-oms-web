import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../sql/20261114_cv_sales_fk_indexes.sql",import.meta.url),"utf8");
test("foreign key supporting indexes are additive, scoped to CV and salesman audit",()=>{
  const rows=s.split("\n").filter(l=>l.startsWith("CREATE INDEX"));
  assert.equal(rows.length,13);
  assert.ok(rows.every(l=>l.includes("IF NOT EXISTS") && l.includes("ON public.")));
  assert.doesNotMatch(s,/DROP\s|TRUNCATE\s|DELETE\s|ALTER\s+POLICY/i);
  assert.match(s,/idx_cv_accounts_approved_by_fk/);
  assert.match(s,/idx_sales_special_price_requests_product_id_fk/);
});
