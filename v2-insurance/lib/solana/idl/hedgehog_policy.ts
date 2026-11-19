/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hedgehog_policy.json`.
 */
export type HedgehogPolicy = {
  "address": "4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe",
  "metadata": {
    "name": "hedgehogPolicy",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Hedgehog Cover: parametric cover sold from a USDC underwriter vault"
  },
  "instructions": [
    {
      "name": "buyPolicy",
      "discriminator": [
        0,
        59,
        201,
        101,
        183,
        3,
        41,
        24
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "business"
          ]
        },
        {
          "name": "quoter",
          "docs": [
            "Hedgehog's pricing server (= underwriter.attestor) co-signs every sale."
          ],
          "signer": true
        },
        {
          "name": "underwriter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "underwriter.mint",
                "account": "underwriter"
              }
            ]
          }
        },
        {
          "name": "business",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  122
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "underwriter"
              },
              {
                "kind": "account",
                "path": "business"
              },
              {
                "kind": "arg",
                "path": "policyId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "policyId",
          "type": "u64"
        },
        {
          "name": "peril",
          "type": "u8"
        },
        {
          "name": "marketRef",
          "type": "string"
        },
        {
          "name": "triggerHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "premium",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "expirePolicy",
      "docs": [
        "Anyone, after expiry + grace, if the attestor never settled: refund the premium."
      ],
      "discriminator": [
        149,
        24,
        43,
        100,
        240,
        50,
        39,
        124
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "underwriter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "underwriter.mint",
                "account": "underwriter"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "fundVault",
      "docs": [
        "Anyone may add USDC to the vault."
      ],
      "discriminator": [
        26,
        33,
        207,
        242,
        119,
        108,
        134,
        73
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "underwriter",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "underwriter.mint",
                "account": "underwriter"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "funderToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initUnderwriter",
      "docs": [
        "Create the singleton underwriter and its PDA-owned USDC vault (ATA)."
      ],
      "discriminator": [
        4,
        64,
        185,
        198,
        176,
        174,
        230,
        231
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "underwriter",
          "docs": [
            "One underwriter per settlement mint: [\"uw\", mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "underwriter"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "attestor",
          "type": "pubkey"
        },
        {
          "name": "maxExposure",
          "type": "u64"
        },
        {
          "name": "graceSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "registerBusiness",
      "discriminator": [
        73,
        228,
        5,
        59,
        229,
        67,
        133,
        82
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "business",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  122
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "monthlyBudget",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setBudget",
      "discriminator": [
        148,
        121,
        226,
        12,
        183,
        120,
        26,
        227
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "business"
          ]
        },
        {
          "name": "business",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  122
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "monthlyBudget",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setUnderwriter",
      "docs": [
        "Authority-only: update attestor / max exposure."
      ],
      "discriminator": [
        100,
        73,
        161,
        131,
        128,
        144,
        113,
        17
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "underwriter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "underwriter.mint",
                "account": "underwriter"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "attestor",
          "type": "pubkey"
        },
        {
          "name": "maxExposure",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settlePolicy",
      "docs": [
        "Attestor posts the outcome. YES pays `payout` to the owner; NO closes the policy."
      ],
      "discriminator": [
        180,
        234,
        21,
        174,
        50,
        214,
        91,
        113
      ],
      "accounts": [
        {
          "name": "attestor",
          "signer": true
        },
        {
          "name": "underwriter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "underwriter.mint",
                "account": "underwriter"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "underwriter"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "business",
      "discriminator": [
        60,
        203,
        129,
        133,
        68,
        183,
        210,
        177
      ]
    },
    {
      "name": "policy",
      "discriminator": [
        222,
        135,
        7,
        163,
        235,
        177,
        33,
        68
      ]
    },
    {
      "name": "underwriter",
      "discriminator": [
        10,
        234,
        225,
        56,
        134,
        71,
        236,
        232
      ]
    }
  ],
  "events": [
    {
      "name": "policyBought",
      "discriminator": [
        142,
        217,
        85,
        122,
        219,
        153,
        95,
        231
      ]
    },
    {
      "name": "policyExpired",
      "discriminator": [
        165,
        34,
        27,
        82,
        79,
        188,
        9,
        244
      ]
    },
    {
      "name": "policySettled",
      "discriminator": [
        67,
        45,
        149,
        235,
        199,
        184,
        83,
        77
      ]
    },
    {
      "name": "vaultFunded",
      "discriminator": [
        192,
        119,
        245,
        193,
        55,
        223,
        195,
        50
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "budgetExceeded",
      "msg": "Premium would exceed the business's 30-day budget"
    },
    {
      "code": 6001,
      "name": "insufficientCapacity",
      "msg": "Vault has insufficient free capacity for this payout"
    },
    {
      "code": 6002,
      "name": "notAttestor",
      "msg": "Signer is not the underwriter's attestor"
    },
    {
      "code": 6003,
      "name": "alreadySettled",
      "msg": "Policy is already settled"
    },
    {
      "code": 6004,
      "name": "notExpired",
      "msg": "Policy has not passed expiry + grace"
    },
    {
      "code": 6005,
      "name": "badParams",
      "msg": "Invalid parameters"
    },
    {
      "code": 6006,
      "name": "notQuoter",
      "msg": "Sale must be co-signed by the underwriter's quoter (attestor)"
    },
    {
      "code": 6007,
      "name": "wrongUnderwriter",
      "msg": "Policy does not belong to this underwriter"
    }
  ],
  "types": [
    {
      "name": "business",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "monthlyBudget",
            "type": "u64"
          },
          {
            "name": "spentThisPeriod",
            "type": "u64"
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "policyCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "type": "u64"
          },
          {
            "name": "peril",
            "type": "u8"
          },
          {
            "name": "marketRef",
            "type": "string"
          },
          {
            "name": "triggerHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "premium",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "policyStatus"
              }
            }
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policyBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "type": "u64"
          },
          {
            "name": "peril",
            "type": "u8"
          },
          {
            "name": "marketRef",
            "type": "string"
          },
          {
            "name": "triggerHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "premium",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "expiry",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "type": "u64"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "policySettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": "bool"
          },
          {
            "name": "paid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "policyStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "paidOut"
          },
          {
            "name": "expired"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "underwriter",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "attestor",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "totalExposure",
            "type": "u64"
          },
          {
            "name": "maxExposure",
            "type": "u64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "policiesSold",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
