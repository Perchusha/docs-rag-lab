// The boundary rules live in @docs-rag-lab/config, where they are tested against fixtures.
// This file only lets the depcruise CLI find them from the repository root.
module.exports = require('./packages/config/dependency-cruiser.cjs')
