import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Investment tiers data
const investmentTiers = [
  { name: 'SHRIMP', minBtc: 0.01, maxBtc: 0.01, dailyPercent: 0.12 },
  { name: 'CRAB', minBtc: 0.1, maxBtc: 0.1, dailyPercent: 0.25 },
  { name: 'OCTOPUS', minBtc: 1, maxBtc: 1, dailyPercent: 0.50 },
  { name: 'DOLPHIN', minBtc: 5, maxBtc: 5, dailyPercent: 0.75 },
  { name: 'SHARK', minBtc: 10, maxBtc: 10, dailyPercent: 1.00 },
  { name: 'WHALE', minBtc: 50, maxBtc: 50, dailyPercent: 1.00 }
];

// Get daily profit percentage based on allocated balance and BTC price
function getDailyProfitPercentage(allocatedBalance: number, btcPrice: number): number {
  // Convert USDT balance to BTC
  const btcAmount = allocatedBalance / btcPrice;

  // Find the appropriate tier
  for (let i = investmentTiers.length - 1; i >= 0; i--) {
    const tier = investmentTiers[i];
    if (btcAmount >= tier.minBtc) {
      return tier.dailyPercent;
    }
  }

  // If below minimum tier, return a small percentage
  return 0.05;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting arbitrage bot processing...");
    
    // Get current BTC price
    const { data: btcPriceData, error: btcPriceError } = await supabase
      .from('market_data')
      .select('price')
      .eq('symbol', 'BTCUSDT')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();
      
    if (btcPriceError) {
      console.error("Error fetching BTC price:", btcPriceError);
      throw new Error(`Failed to fetch BTC price: ${btcPriceError.message}`);
    }
    
    const btcPrice = btcPriceData.price;
    console.log(`Current BTC price: ${btcPrice}`);
    
    // Get all active robot states
    const { data: activeRobots, error: robotsError } = await supabase
      .from('robot_states')
      .select('*')
      .eq('is_active', true);
      
    if (robotsError) {
      console.error("Error fetching active robots:", robotsError);
      throw new Error(`Failed to fetch active robots: ${robotsError.message}`);
    }
    
    console.log(`Found ${activeRobots?.length || 0} active robots to process`);
    
    let processedCount = 0;
    let updatedCount = 0;

    // Get current date at midnight UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    
    if (activeRobots && activeRobots.length > 0) {
      for (const robot of activeRobots) {
        processedCount++;
        
        // Check if we have a custom daily profit percentage set for this robot
        let dailyProfitPercentage;
        if (robot.custom_daily_profit_percentage !== null && robot.custom_daily_profit_percentage !== undefined) {
          // Use the custom percentage set by admin
          dailyProfitPercentage = robot.custom_daily_profit_percentage;
          console.log(`Using custom daily profit percentage for robot ${robot.id}: ${dailyProfitPercentage}%`);
        } else {
          // Use the standard tier-based calculation
          dailyProfitPercentage = getDailyProfitPercentage(robot.allocated_balance, btcPrice);
          console.log(`Using tier-based daily profit percentage for robot ${robot.id}: ${dailyProfitPercentage}%`);
        }
        
        // Check if we need to reset daily profit (if last_profit_timestamp is from a previous day)
        let shouldResetDailyProfit = false;
        if (robot.last_profit_timestamp) {
          const lastProfitDate = new Date(robot.last_profit_timestamp);
          lastProfitDate.setUTCHours(0, 0, 0, 0);
          shouldResetDailyProfit = lastProfitDate < today;
        }
        
        // Calculate daily profit using the determined percentage
        const dailyProfit = robot.allocated_balance * (dailyProfitPercentage / 100);
        
        // Update robot state (profit compounds in allocated_balance)
        const { error: updateError } = await supabase
          .from('robot_states')
          .update({
            allocated_balance: robot.allocated_balance + dailyProfit,
            todays_profit: shouldResetDailyProfit ? dailyProfit : robot.todays_profit + dailyProfit,
            last_profit_timestamp: new Date().toISOString()
          })
          .eq('id', robot.id);

        if (updateError) {
          console.error(`Error updating robot ${robot.id}:`, updateError);
          continue;
        }

        updatedCount++;
        console.log(`Compounded ${dailyProfit.toFixed(2)} USDT into robot allocated_balance for user ${robot.user_id}`);
        
        // Add transaction record for robot profit
        await supabase
          .from('transactions')
          .insert({
            user_id: robot.user_id,
            type: 'robot_profit',
            amount: dailyProfit,
            description: `Daily profit from AI Arbitrage Engine (${dailyProfitPercentage}%)`,
            status: 'completed'
          });
          
        // Log the profit
        await supabase
          .from('system_logs')
          .insert({
            action: 'robot_daily_profit',
            details: `Robot ${robot.id} earned ${dailyProfit.toFixed(2)} USDT (${dailyProfitPercentage}% of ${robot.allocated_balance.toFixed(2)} USDT)`
          });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Arbitrage bot processing completed. Processed: ${processedCount}, Updated: ${updatedCount}`,
        timestamp: new Date().toISOString()
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in process-arbitrage-bot function:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 500,
      }
    );
  }
});