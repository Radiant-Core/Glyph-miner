// KangarooTwelve (K12) mining shader for Glyph mining
// Self-contained implementation with proper WGSL syntax

@group(0) @binding(0) var<storage, read> midstate: array<u32>;
@group(0) @binding(1) var<storage, read> target: array<u32>;
@group(0) @binding(2) var<storage, read_write> results: array<vec4<u32>>;

// Keccak round constants (first 12 for K12)
const RC0: u32 = 0x00000001u;
const RC1: u32 = 0x00008082u;
const RC2: u32 = 0x0000808au;
const RC3: u32 = 0x80008000u;
const RC4: u32 = 0x0000808bu;
const RC5: u32 = 0x80000001u;
const RC6: u32 = 0x80008081u;
const RC7: u32 = 0x00008009u;
const RC8: u32 = 0x0000008au;
const RC9: u32 = 0x00000088u;
const RC10: u32 = 0x80008009u;
const RC11: u32 = 0x8000000au;

// Rotation helper
fn rotl32(x: u32, n: u32) -> u32 {
    return (x << n) | (x >> (32u - n));
}

// Theta step
fn theta(state: ptr<function, array<u32, 25>>) {
    var c: array<u32, 5>;
    
    // Compute column parity
    for (var i = 0u; i < 5u; i = i + 1u) {
        c[i] = (*state)[i] ^ (*state)[i + 5u] ^ (*state)[i + 10u] ^ (*state)[i + 15u] ^ (*state)[i + 20u];
    }
    
    // Apply theta transformation
    for (var i = 0u; i < 5u; i = i + 1u) {
        let d = c[(i + 4u) % 5u] ^ rotl32(c[(i + 1u) % 5u], 1u);
        for (var j = 0u; j < 5u; j = j + 1u) {
            (*state)[i + j * 5u] ^= d;
        }
    }
}

// Rho and Pi steps combined
fn rho_pi(state: ptr<function, array<u32, 25>>) {
    var temp = (*state)[1u];
    var idx = 10u;
    
    // Rotation amounts for rho
    let rho_offsets = array<u32, 24>(
        1u, 3u, 6u, 10u, 15u, 21u, 28u, 36u, 45u, 55u, 2u, 14u,
        27u, 41u, 56u, 8u, 25u, 43u, 62u, 18u, 39u, 61u, 20u, 44u
    );
    
    for (var i = 0u; i < 24u; i = i + 1u) {
        let j = idx;
        idx = (idx * 2u + idx * 3u) % 25u; // Pi transformation index
        let temp2 = (*state)[j];
        (*state)[j] = rotl32(temp, rho_offsets[i] % 32u);
        temp = temp2;
    }
}

// Chi step
fn chi(state: ptr<function, array<u32, 25>>) {
    for (var j = 0u; j < 5u; j = j + 1u) {
        let base = j * 5u;
        let b0 = (*state)[base];
        let b1 = (*state)[base + 1u];
        let b2 = (*state)[base + 2u];
        let b3 = (*state)[base + 3u];
        let b4 = (*state)[base + 4u];
        
        (*state)[base] = b0 ^ (~b1 & b2);
        (*state)[base + 1u] = b1 ^ (~b2 & b3);
        (*state)[base + 2u] = b2 ^ (~b3 & b4);
        (*state)[base + 3u] = b3 ^ (~b4 & b0);
        (*state)[base + 4u] = b4 ^ (~b0 & b1);
    }
}

// Get round constant
fn get_rc(round: u32) -> u32 {
    switch (round) {
        case 0u: { return RC0; }
        case 1u: { return RC1; }
        case 2u: { return RC2; }
        case 3u: { return RC3; }
        case 4u: { return RC4; }
        case 5u: { return RC5; }
        case 6u: { return RC6; }
        case 7u: { return RC7; }
        case 8u: { return RC8; }
        case 9u: { return RC9; }
        case 10u: { return RC10; }
        case 11u: { return RC11; }
        default: { return 0u; }
    }
}

// Keccak-p permutation (12 rounds for K12)
fn keccak_p(state: ptr<function, array<u32, 25>>) {
    for (var round = 0u; round < 12u; round = round + 1u) {
        theta(state);
        rho_pi(state);
        chi(state);
        (*state)[0u] ^= get_rc(round);
    }
}

// Check if hash meets target
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
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let nonce = global_id.x;
    
    // Initialize K12 state from midstate
    var state: array<u32, 25>;
    for (var i = 0u; i < 25u; i = i + 1u) {
        if (i < 16u) {
            state[i] = midstate[i];
        } else {
            state[i] = 0u;
        }
    }
    
    // Add nonce to state
    state[0u] ^= nonce;
    state[1u] ^= global_id.y;
    
    // K12 padding
    state[16u] ^= 0x07u; // K12 domain separator
    state[24u] ^= 0x80000000u; // Final bit
    
    // Perform K12 permutation
    keccak_p(&state);
    
    // Extract hash (first 8 words)
    var hash: array<u32, 8>;
    for (var i = 0u; i < 8u; i = i + 1u) {
        hash[i] = state[i];
    }
    
    // Check if hash meets target
    if (check_target(hash)) {
        let idx = atomicAdd(&results[0u].x, 1u);
        if (idx < 255u) {
            results[idx + 1u] = vec4<u32>(nonce, hash[0u], hash[1u], hash[2u]);
        }
    }
}
