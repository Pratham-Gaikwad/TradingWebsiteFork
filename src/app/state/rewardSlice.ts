import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "./store";
import { getRdt } from "../subscriptions";
import { NonFungibleResourcesCollectionItem } from "@radixdlt/radix-dapp-toolkit";
import {
  getAccountsRewardsApiData,
  getAccountsRewardsFromApiData,
  getOrdersRewardsApiData,
  getOrderRewardsFromApiData,
  OrderRewards,
} from "./rewardUtils";

export interface RewardState {
  recieptIds: string[];
  rewardsTotal: number;
  config: RewardConfig;
}

interface RewardConfig {
  resourcePrefix: string;
  rewardComponent: string;
  rewardNFTAddress: string;
  rewardOrderAddress: string;
  rewardVaultAddress: string;
  resourceAddresses: {
    [key: string]: {
      resourceAddress: string;
    };
  };
}

//State will default to stokenet values if not provided
const initialState: RewardState = {
  recieptIds: [],
  rewardsTotal: 0,
  config: {
    resourcePrefix:
      process.env.NEXT_PUBLIC_RESOURCE_PREFIX || "account_tdx_2_1",
    rewardComponent:
      process.env.NEXT_PUBLIC_CLAIM_COMPONENT ||
      "component_tdx_2_1cz6m9sarml3fltfslegdyuy3s6x2rkxtzlm7k8amflt9d2lh6r05pj",
    rewardNFTAddress:
      process.env.NEXT_PUBLIC_CLAIM_NFT_ADDRESS ||
      "resource_tdx_2_1nfpa6s98aamfmw5r04phl0crtxpdl9j8qpz5pwqey2gqqk0ptepc360",
    rewardOrderAddress:
      process.env.NEXT_PUBLIC_CLAIM_ORDER_ADDRESS ||
      "internal_keyvaluestore_tdx_2_1kzd9du9jmjlxdfcthgwtwlsug6z05hw0r864mwhhtgay3yxvuqdvds",
    rewardVaultAddress:
      process.env.NEXT_PUBLIC_CLAIM_VAULT_ADDRESS ||
      "internal_keyvaluestore_tdx_2_1kqy9qv7nr7mc42fm7nlhald7g4lyzazrwyjsu8zwxsqmzjv6j7wcnn",
    resourceAddresses: {
      DEXTERXRD: {
        resourceAddress:
          process.env.NEXT_PUBLIC_RESOURCE_ADDRESS_DEXTERXRD ||
          "resource_tdx_2_1ng6vf9g4d30dw8h6h4t2t6e3mfxrhpw8d0n5dkpzh4xaqzqha57cd2",
      },
    },
  },
};

type NonFungibleResource = NonFungibleResourcesCollectionItem & {
  vaults: {
    items: {
      vault_address: string;
      total_count: string;
      items: string;
    }[];
  };
};

export const fetchReciepts = createAsyncThunk<
  undefined, // Return type of the payload creator
  undefined, // argument type
  {
    state: RewardState;
  }
>("rewards/fetchReciepts", async (_, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  const rdt = getRdt();
  if (!rdt) return;
  const claimComponentAddress = process.env.NEXT_PUBLIC_CLAIM_COMPONENT;
  const resourceAddress = process.env.NEXT_PUBLIC_RESOURCE_ADDRESS_DEXTERXRD;
  if (!claimComponentAddress) return;
  const walletData = rdt.walletApi.getWalletData();
  //Todo support multiple wallets ids
  const accountAddress = walletData.accounts[0].address;

  try {
    const response =
      await rdt.gatewayApi.state.innerClient.entityNonFungiblesPage({
        stateEntityNonFungiblesPageRequest: {
          address: accountAddress,
          // eslint-disable-next-line camelcase
          aggregation_level: "Vault",
          // eslint-disable-next-line camelcase
          opt_ins: { non_fungible_include_nfids: true },
        },
      });
    const { items } = response;

    const accountReceiptVault =
      (items.find(
        // eslint-disable-next-line camelcase
        ({ resource_address }) => resource_address === resourceAddress
      ) as NonFungibleResource) || null;

    if (accountReceiptVault && accountReceiptVault?.vaults.items.length > 0) {
      dispatch(
        rewardSlice.actions.updateReciepts(
          accountReceiptVault?.vaults.items[0].items as string[]
        )
      );
    }
  } catch (error) {
    return undefined;
  }

  return undefined;
});

export const fetchRewards = createAsyncThunk<
  Number | undefined, // Return type of the payload creator
  undefined, // argument type
  {
    state: RootState;
  }
>("rewards/fetchRewards", async (_, thunkAPI) => {
  const state = thunkAPI.getState();
  const dispatch = thunkAPI.dispatch;

  //console.log(state.config);
  const rdt = getRdt();
  if (!rdt) return;

  const walletData = rdt.walletApi.getWalletData();
  //Todo support multiple wallets ids
  const accountAddress = walletData.accounts[0].address;
  try {
    let recieptIds = state.rewardSlice.recieptIds;
    if (recieptIds.length <= 0) return;
    const accountRewardData = await getAccountsRewardsApiData([accountAddress]);
    const accountRewards = (
      await getAccountsRewardsFromApiData(accountRewardData)
    )[0].rewards[0].tokenRewards[0].amount;
    const prefixedReceiptIds = recieptIds.map(
      (id) =>
        `${state.rewardSlice.config.resourceAddresses.DEXTERXRD.resourceAddress}${id}`
    );

    const orderRewardsData = await getOrdersRewardsApiData(
      state.rewardSlice.config.rewardOrderAddress,
      prefixedReceiptIds
    );
    const orderRewards = await getOrderRewardsFromApiData(orderRewardsData);
    const sumTokenRewards = (orders: OrderRewards[]) =>
      orders.reduce(
        (total, order) =>
          total +
          order.rewards.reduce(
            (rewardTotal, reward) =>
              rewardTotal +
              reward.tokenRewards.reduce(
                (tokenSum, tokenReward) =>
                  tokenSum + Number(tokenReward.amount),
                0
              ),
            0
          ),
        0
      );

    const total = sumTokenRewards(orderRewards) + Number(accountRewards);

    dispatch(rewardSlice.actions.updateRewardsTotal(total));

    return total;
  } catch (error) {
    console.log(error);
    return undefined;
  }

  return undefined;
});

export const rewardSlice = createSlice({
  name: "reward",
  initialState,

  // synchronous reducers
  reducers: {
    claimRewards: (state) => {
      const rdt = getRdt();
      if (!rdt) return;

      const recieptIds = state.recieptIds;
      if (recieptIds === null) return;
      if (recieptIds.length === 0) return;

      const walletData = rdt.walletApi.getWalletData();
      const accountAddress = walletData.accounts[0].address;
      const resourceAddress =
        process.env.NEXT_PUBLIC_RESOURCE_ADDRESS_DEXTERXRD;

      const nonfungibleLocalId = accountAddress.replace(
        new RegExp(state.config.resourcePrefix, "g"),
        ""
      );

      const nftArray = recieptIds
        .map((id) => `NonFungibleLocalId("${id}")`)
        .join(",");

      const claimManifest = `
        CALL_METHOD 
          Address("${accountAddress}") 
          "create_proof_of_non_fungibles" 
          Address("${state.config.rewardNFTAddress}") 
          Array<NonFungibleLocalId>(NonFungibleLocalId("<${nonfungibleLocalId}>")); 
        POP_FROM_AUTH_ZONE 
          Proof("account_proof_1");
          CALL_METHOD Address("${accountAddress}") 
          "create_proof_of_non_fungibles" 
          Address("${resourceAddress}") 
          Array<NonFungibleLocalId>(${nftArray}); 
        CREATE_PROOF_FROM_AUTH_ZONE_OF_ALL 
          Address("${state.config.resourceAddresses.DEXTERXRD.resourceAddress}")   
          Proof("proof_1");
        CALL_METHOD 
          Address("${state.config.rewardComponent}") 
          "claim_rewards" 
          Array<Proof>(Proof("account_proof_1")) 
          Array<Proof>(Proof("proof_1"));
        CALL_METHOD 
          Address("${accountAddress}") 
          "deposit_batch" 
          Expression("ENTIRE_WORKTOP");
        `;

      rdt.walletApi.sendTransaction({
        transactionManifest: claimManifest,
      });
    },
    getEarnedRewards: (state) => {
      const rdt = getRdt();
      if (!rdt) return;

      const recieptIds = state.recieptIds;
      if (recieptIds === null) return;
      if (recieptIds.length === 0) return;

      const walletData = rdt.walletApi.getWalletData();
      const accountAddress = walletData.accounts[0].address;
      const claimNFTAddress = process.env.NEXT_PUBLIC_CLAIM_NFT_ADDRESS;
      const resourcePrefix = process.env.NEXT_PUBLIC_RESOURCE_PREFIX;
      if (!resourcePrefix) return;
      const nonfungibleLocalId = accountAddress.replace(
        new RegExp(resourcePrefix, "g"),
        ""
      );
      const nftArray = recieptIds
        .map((id) => `NonFungibleLocalId("${id}")`)
        .join(",");

      const claimManifest = `
        CALL_METHOD 
          Address("${accountAddress}") 
          "create_proof_of_non_fungibles" 
          Address("${claimNFTAddress}") 
          Array<NonFungibleLocalId>(NonFungibleLocalId("<${nonfungibleLocalId}>")); 
        POP_FROM_AUTH_ZONE 
          Proof("account_proof_1");
          CALL_METHOD Address("${accountAddress}") 
          "create_proof_of_non_fungibles" 
          Address("${state.config.resourceAddresses.DEXTERXRD.resourceAddress}") 
          Array<NonFungibleLocalId>(${nftArray}); 
        CREATE_PROOF_FROM_AUTH_ZONE_OF_ALL 
          Address("${state.config.resourceAddresses.DEXTERXRD.resourceAddress}")  
          Proof("proof_1");
        CALL_METHOD 
          Address("${state.config.rewardComponent}") 
          "claim_rewards" 
          Array<Proof>(Proof("account_proof_1")) 
          Array<Proof>(Proof("proof_1"));
        CALL_METHOD 
          Address("${accountAddress}") 
          "deposit_batch" 
          Expression("ENTIRE_WORKTOP");
        `;

      rdt.walletApi.sendTransaction({
        transactionManifest: claimManifest,
      });
    },
    updateReciepts: (state, action: PayloadAction<string[]>) => {
      state.recieptIds = action.payload;
    },
    updateRewardsTotal: (state, action: PayloadAction<number>) => {
      state.rewardsTotal = action.payload;
    },
  },
});
