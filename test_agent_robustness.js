const { runAgent, TOOLS } = require('./src/agent');

// Mock Context
const mockCtx = {
    sendChatAction: (action) => console.log(`[MOCK CTX] Action: ${action}`),
    reply: (msg) => console.log(`[MOCK CTX] Reply: ${msg}`)
};

// Test Runner
async function runTest(name, mockAiBehavior) {
    console.log(`\n--- TEST: ${name} ---`);
    try {
        const result = await runAgent(mockCtx, [{ role: 'user', content: 'test' }], TOOLS, 0, mockAiBehavior);
        console.log(`RESULT: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
        return result;
    } catch (e) {
        console.error(`CRASHED: ${e.message}`);
        return "CRASH";
    }
}

async function main() {
    // 1. Test String Error (The original crash cause)
    await runTest("AI Returns String Error", async () => {
        return "Error de conexion con NVIDIA API";
    });

    // 2. Test Invalid JSON in Arguments
    await runTest("AI Returns Invalid JSON Args", async () => {
        return {
            tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                    name: 'searchWeb',
                    arguments: '{ "query": "test", ' // Broken JSON
                }
            }]
        };
    });

    // 3. Test Tool Execution Error (Simulated inside agent.js logic path, hard to mock perfectly without mocking searchWeb too, but we can see if it catches)
    // Actually, searchWeb is imported in agent.js. To mock it properly we'd need to mock require.
    // For now, let's assume searchWeb might fail. 
    // We can simulate a "valid" tool call that points to a non-existent tool? No, name is checked.
    // We can simulate a tool call where valid JSON is passed but maybe arguments are missing?
    await runTest("AI Returns Valid JSON but missing args", async () => {
        return {
            tool_calls: [{
                id: 'call_456',
                type: 'function',
                function: {
                    name: 'searchWeb',
                    arguments: '{}' // Valid JSON, but maybe empty query?
                }
            }]
        };
    });

    // 4. Test Recursive Loop (Standard success case)
    let turn = 0;
    await runTest("Recursive Success Loop", async (msgs) => {
        turn++;
        if (turn === 1) {
            return {
                tool_calls: [{
                    id: 'call_789',
                    type: 'function',
                    function: {
                        name: 'getGlobalTime',
                        arguments: '{ "location": "Madrid" }'
                    }
                }]
            };
        }
        return { content: "son las 5" };
    });

    console.log("\n--- TESTS COMPLETED ---");
}

main();
