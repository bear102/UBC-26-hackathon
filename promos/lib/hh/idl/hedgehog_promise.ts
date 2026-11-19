/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hedgehog_promise.json`.
 */
export type HedgehogPromise = {
  "address": "6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf",
  "metadata": {
    "name": "hedgehogPromise",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Hedgehog: hedge-gated money-back promises with a USDC escrow vault"
  },
  "instructions": [
    {
      "name": "attestHedge",
      "discriminator": [
        201,
        60,
        3,
        125,
        56,
        237,
        181,
        30
      ],
      "accounts": [
        {
          "name": "attestor",
          "signer": true,
          "address": "BC2GGEKLBxCKMsAakUaHckmMuEjF71fmoPCFjP4E4aVN"
        },
        {
          "name": "promise",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "phase",
          "type": "u8"
        },
        {
          "name": "qtyCenti",
          "type": {
            "vec": "u32"
          }
        },
        {
          "name": "premiumMicros",
          "type": "u64"
        },
        {
          "name": "ordersHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "observedAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "attestOutcome",
      "discriminator": [
        115,
        210,
        81,
        230,
        222,
        14,
        85,
        209
      ],
      "accounts": [
        {
          "name": "relayer",
          "signer": true,
          "address": "Abq5tHs4mFZWFXNK53B5aKfgfnAPDa6jQHmTexDwDAGi"
        },
        {
          "name": "promise",
          "writable": true
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise.merchant",
                "account": "promise"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "winningSymbol",
          "type": "string"
        },
        {
          "name": "canonicalHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "resolvedAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "closeReceipts",
      "discriminator": [
        144,
        230,
        36,
        140,
        163,
        61,
        224,
        177
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "promise"
        }
      ],
      "args": []
    },
    {
      "name": "createPromise",
      "discriminator": [
        233,
        170,
        35,
        24,
        34,
        120,
        82,
        200
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "promise",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  105,
                  115,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "arg",
                "path": "promiseId"
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
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise"
              }
            ]
          }
        },
        {
          "name": "authorityUsdc",
          "writable": true
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "promiseId",
          "type": "u64"
        },
        {
          "name": "eventTicker",
          "type": "string"
        },
        {
          "name": "strip",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "refundUnits",
          "type": "u64"
        },
        {
          "name": "cap",
          "type": "u32"
        },
        {
          "name": "salesCloseTs",
          "type": "i64"
        },
        {
          "name": "expectedResolveTs",
          "type": "i64"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "issueReceipt",
      "discriminator": [
        128,
        231,
        32,
        119,
        210,
        139,
        80,
        68
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "promise",
          "writable": true
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise"
              },
              {
                "kind": "account",
                "path": "promise.sold",
                "account": "promise"
              }
            ]
          }
        },
        {
          "name": "holder"
        },
        {
          "name": "holderAta"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "codeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refundCrank",
      "discriminator": [
        22,
        80,
        109,
        43,
        247,
        68,
        152,
        244
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "promise",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise.merchant",
                "account": "promise"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "release",
      "discriminator": [
        253,
        249,
        15,
        206,
        28,
        127,
        193,
        241
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "promise",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "promise"
              }
            ]
          }
        },
        {
          "name": "authorityUsdc",
          "writable": true
        },
        {
          "name": "usdcMint",
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "merchant",
      "discriminator": [
        71,
        235,
        30,
        40,
        231,
        21,
        32,
        64
      ]
    },
    {
      "name": "promise",
      "discriminator": [
        172,
        179,
        140,
        81,
        180,
        237,
        23,
        191
      ]
    },
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    }
  ],
  "events": [
    {
      "name": "hedgeAttested",
      "discriminator": [
        113,
        236,
        31,
        235,
        110,
        63,
        36,
        63
      ]
    },
    {
      "name": "outcomeAttested",
      "discriminator": [
        249,
        112,
        243,
        78,
        100,
        115,
        176,
        160
      ]
    },
    {
      "name": "promiseCreated",
      "discriminator": [
        5,
        187,
        200,
        165,
        198,
        146,
        52,
        208
      ]
    },
    {
      "name": "receiptIssued",
      "discriminator": [
        233,
        140,
        157,
        214,
        59,
        46,
        229,
        231
      ]
    },
    {
      "name": "refundPaid",
      "discriminator": [
        191,
        158,
        89,
        168,
        130,
        235,
        207,
        139
      ]
    },
    {
      "name": "refundSkipped",
      "discriminator": [
        241,
        248,
        182,
        6,
        231,
        154,
        196,
        167
      ]
    },
    {
      "name": "released",
      "discriminator": [
        232,
        229,
        255,
        136,
        101,
        189,
        15,
        220
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "salesClosed",
      "msg": "Sales are closed for this promise"
    },
    {
      "code": 6001,
      "name": "soldOut",
      "msg": "All promises at this price are taken"
    },
    {
      "code": 6002,
      "name": "unhedged",
      "msg": "No hedge, no promise: hedged capacity is used up"
    },
    {
      "code": 6003,
      "name": "liabilityLocked",
      "msg": "The vault is locked until the promise settles"
    },
    {
      "code": 6004,
      "name": "unauthorizedAttestor",
      "msg": "Signer is not the authorized attestor/relayer"
    },
    {
      "code": 6005,
      "name": "alreadyRefunded",
      "msg": "Receipt already refunded"
    },
    {
      "code": 6006,
      "name": "notSettled",
      "msg": "Promise is not settled YES"
    },
    {
      "code": 6007,
      "name": "alreadySettled",
      "msg": "Promise already settled"
    },
    {
      "code": 6008,
      "name": "invalidStrip",
      "msg": "Invalid strip or ticker"
    },
    {
      "code": 6009,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6010,
      "name": "invalidTimes",
      "msg": "Invalid times"
    },
    {
      "code": 6011,
      "name": "tooEarly",
      "msg": "Too early"
    },
    {
      "code": 6012,
      "name": "staleAttestation",
      "msg": "Stale attestation"
    },
    {
      "code": 6013,
      "name": "receiptMismatch",
      "msg": "Receipt / token account mismatch"
    },
    {
      "code": 6014,
      "name": "wrongMint",
      "msg": "Wrong mint"
    },
    {
      "code": 6015,
      "name": "notMerchant",
      "msg": "Signer is not the merchant"
    }
  ],
  "types": [
    {
      "name": "hedgeAttested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "phase",
            "type": "u8"
          },
          {
            "name": "capacity",
            "type": "u32"
          },
          {
            "name": "heldBps",
            "type": "u16"
          },
          {
            "name": "ordersHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "observedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "merchant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "promisesCreated",
            "type": "u32"
          },
          {
            "name": "promisesClosed",
            "type": "u32"
          },
          {
            "name": "cutoffHeldFull",
            "type": "u32"
          },
          {
            "name": "hedgeBreaks",
            "type": "u32"
          },
          {
            "name": "receiptsIssued",
            "type": "u64"
          },
          {
            "name": "refundsPaid",
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
      "name": "outcomeAttested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "yes",
            "type": "bool"
          },
          {
            "name": "winningSymbol",
            "type": "string"
          },
          {
            "name": "canonicalHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "heldBpsMin",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "promise",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "promiseId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "eventTicker",
            "type": "string"
          },
          {
            "name": "stripLen",
            "type": "u8"
          },
          {
            "name": "strip",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    48
                  ]
                },
                6
              ]
            }
          },
          {
            "name": "hedgedCenti",
            "type": {
              "array": [
                "u32",
                6
              ]
            }
          },
          {
            "name": "refundUnits",
            "type": "u64"
          },
          {
            "name": "cap",
            "type": "u32"
          },
          {
            "name": "sold",
            "type": "u32"
          },
          {
            "name": "refunded",
            "type": "u32"
          },
          {
            "name": "hedgedCapacity",
            "type": "u32"
          },
          {
            "name": "heldBpsCutoff",
            "type": "u16"
          },
          {
            "name": "heldBpsMin",
            "type": "u16"
          },
          {
            "name": "phasesDone",
            "type": "u8"
          },
          {
            "name": "premiumMicros",
            "type": "u64"
          },
          {
            "name": "ordersHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "salesCloseTs",
            "type": "i64"
          },
          {
            "name": "expectedResolveTs",
            "type": "i64"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "winningSymbol",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "outcomeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "promiseCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "eventTicker",
            "type": "string"
          },
          {
            "name": "stripLen",
            "type": "u8"
          },
          {
            "name": "refundUnits",
            "type": "u64"
          },
          {
            "name": "cap",
            "type": "u32"
          },
          {
            "name": "salesCloseTs",
            "type": "i64"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "receipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "holderAta",
            "type": "pubkey"
          },
          {
            "name": "codeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "refunded",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "receiptIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "holder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "refundPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "refundSkipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "released",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "promise",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "cancelled",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
