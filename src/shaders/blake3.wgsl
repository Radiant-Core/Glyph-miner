// Blake3 mining shader for Glyph mining
// Self-contained implementation without includes

@group(0) @binding(0) var<storage, read> midstate: array<u32>;
@group(0) @binding(1) var<storage, read> target: array<u32>;
@group(0) @binding(2) var<storage, read_write> results: array<vec4<u32>>;

// Blake3 IV constants
const IV0: u32 = 0x6A09E667u;
const IV1: u32 = 0xBB67AE85u;
const IV2: u32 = 0x3C6EF372u;
const IV3: u32 = 0xA54FF53Au;
const IV4: u32 = 0x510E527Fu;
const IV5: u32 = 0x9B05688Cu;
const IV6: u32 = 0x1F83D9ABu;
const IV7: u32 = 0x5BE0CD19u;

// Rotation helper
fn rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

// Blake3 G mixing function (inline version)
fn blake3_g(
    state: ptr<function, array<u32, 16>>,
    a: u32, b: u32, c: u32, d: u32,
    mx: u32, my: u32
) {
    (*state)[a] = (*state)[a] + (*state)[b] + mx;
    (*state)[d] = rotr((*state)[d] ^ (*state)[a], 16u);
    (*state)[c] = (*state)[c] + (*state)[d];
    (*state)[b] = rotr((*state)[b] ^ (*state)[c], 12u);
    (*state)[a] = (*state)[a] + (*state)[b] + my;
    (*state)[d] = rotr((*state)[d] ^ (*state)[a], 8u);
    (*state)[c] = (*state)[c] + (*state)[d];
    (*state)[b] = rotr((*state)[b] ^ (*state)[c], 7u);
}

// Blake3 round function
fn blake3_round(state: ptr<function, array<u32, 16>>, m: ptr<function, array<u32, 16>>) {
    // Column step
    blake3_g(state, 0u, 4u, 8u, 12u, (*m)[0u], (*m)[1u]);
    blake3_g(state, 1u, 5u, 9u, 13u, (*m)[2u], (*m)[3u]);
    blake3_g(state, 2u, 6u, 10u, 14u, (*m)[4u], (*m)[5u]);
    blake3_g(state, 3u, 7u, 11u, 15u, (*m)[6u], (*m)[7u]);
    
    // Diagonal step
    blake3_g(state, 0u, 5u, 10u, 15u, (*m)[8u], (*m)[9u]);
    blake3_g(state, 1u, 6u, 11u, 12u, (*m)[10u], (*m)[11u]);
    blake3_g(state, 2u, 7u, 8u, 13u, (*m)[12u], (*m)[13u]);
    blake3_g(state, 3u, 4u, 9u, 14u, (*m)[14u], (*m)[15u]);
}

// Permute message schedule
fn permute_msg(m: ptr<function, array<u32, 16>>) {
    let t0 = (*m)[0u]; let t1 = (*m)[1u]; let t2 = (*m)[2u]; let t3 = (*m)[3u];
    let t4 = (*m)[4u]; let t5 = (*m)[5u]; let t6 = (*m)[6u]; let t7 = (*m)[7u];
    let t8 = (*m)[8u]; let t9 = (*m)[9u]; let t10 = (*m)[10u]; let t11 = (*m)[11u];
    let t12 = (*m)[12u]; let t13 = (*m)[13u]; let t14 = (*m)[14u]; let t15 = (*m)[15u];
    
    (*m)[0u] = t2; (*m)[1u] = t6; (*m)[2u] = t3; (*m)[3u] = t10;
    (*m)[4u] = t7; (*m)[5u] = t0; (*m)[6u] = t4; (*m)[7u] = t13;
    (*m)[8u] = t1; (*m)[9u] = t11; (*m)[10u] = t12; (*m)[11u] = t5;
    (*m)[12u] = t9; (*m)[13u] = t14; (*m)[14u] = t15; (*m)[15u] = t8;
}

// Check if hash meets target difficulty
fn check_target(hash: array<u32, 8>) -> bool {
    for (var i = 0u; i < 8u; i = i + 1u) {
        if (hash[i] < target[i]) {
            return true;
        }
        if (hash[i] > target[i]) {
            return false;
        }
    }
    return false;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let nonce = id.x;
    
    // Initialize chaining value from midstate
    var cv: array<u32, 8>;
    for (var i = 0u; i < 8u; i = i + 1u) {
        cv[i] = midstate[i];
    }
    
    // Prepare message block with nonce
    var m: array<u32, 16>;
    m[0u] = midstate[8u];
    m[1u] = midstate[9u];
    m[2u] = midstate[10u];
    m[3u] = midstate[11u];
    m[4u] = midstate[12u];
    m[5u] = midstate[13u];
    m[6u] = midstate[14u];
    m[7u] = midstate[15u];
    m[8u] = nonce;
    m[9u] = id.y;
    m[10u] = 0u;
    m[11u] = 0u;
    m[12u] = 0u;
    m[13u] = 0u;
    m[14u] = 0u;
    m[15u] = 0u;
    
    // Initialize compression state
    var state: array<u32, 16>;
    state[0u] = cv[0u]; state[1u] = cv[1u]; state[2u] = cv[2u]; state[3u] = cv[3u];
    state[4u] = cv[4u]; state[5u] = cv[5u]; state[6u] = cv[6u]; state[7u] = cv[7u];
    state[8u] = IV0; state[9u] = IV1; state[10u] = IV2; state[11u] = IV3;
    state[12u] = 0u; // counter low
    state[13u] = 0u; // counter high
    state[14u] = 64u; // block length
    state[15u] = 0x0Bu; // flags: CHUNK_START | CHUNK_END | ROOT
    
    // 7 rounds of Blake3 compression
    for (var r = 0u; r < 7u; r = r + 1u) {
        blake3_round(&state, &m);
        permute_msg(&m);
    }
    
    // Finalize: XOR upper and lower halves with CV
    var hash: array<u32, 8>;
    for (var i = 0u; i < 8u; i = i + 1u) {
        hash[i] = state[i] ^ state[i + 8u];
    }
    
    // Check if hash meets target
    if (check_target(hash)) {
        let idx = atomicAdd(&results[0u].x, 1u);
        if (idx < 255u) {
            results[idx + 1u] = vec4<u32>(nonce, hash[0u], hash[1u], hash[2u]);
        }
    }
}
