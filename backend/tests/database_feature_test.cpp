#define ORAL_TRAINING_NO_MAIN
#include "../src/main.cpp"

#include <cstdlib>
#include <iostream>

namespace {

constexpr char kLearnerId[] = "feature-test-learner";
constexpr char kPeerId[] = "feature-test-peer";
constexpr char kAdminId[] = "feature-test-admin";
constexpr char kOutsiderId[] = "feature-test-outsider";
constexpr char kReportSessionId[] = "feature-test-report";

void cleanupFeatureUsers(const std::string& database_url) {
  pqxx::connection connection(database_url);
  pqxx::work tx(connection);
  for (const std::string user_id : {std::string(kLearnerId), std::string(kPeerId),
                                    std::string(kAdminId), std::string(kOutsiderId)}) {
    tx.exec_params("DELETE FROM supervisor_team_members WHERE learner_id = $1 OR supervisor_id = $1", user_id);
    tx.exec_params("DELETE FROM auth_sessions WHERE user_id = $1", user_id);
    tx.exec_params("DELETE FROM learner_checkins WHERE user_id = $1", user_id);
    tx.exec_params("DELETE FROM roleplay_sessions WHERE user_id = $1", user_id);
    tx.exec_params("DELETE FROM sessions WHERE user_id = $1", user_id);
    tx.exec_params("DELETE FROM users WHERE id = $1", user_id);
  }
  tx.commit();
}

bool hasMember(const json& members, const std::string& id) {
  for (const auto& member : members) {
    if (member.value("id", "") == id) return true;
  }
  return false;
}

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
  const char* raw_url = std::getenv("ORAL_TRAINING_TEST_DATABASE_URL");
  if (raw_url == nullptr || std::string(raw_url).empty()) {
    std::cout << "database feature test skipped: ORAL_TRAINING_TEST_DATABASE_URL is not set\n";
    return 77;
  }
  const std::string database_url(raw_url);
  auto lower_url = database_url;
  std::transform(lower_url.begin(), lower_url.end(), lower_url.begin(), [](unsigned char value) {
    return static_cast<char>(std::tolower(value));
  });
  if (lower_url.find("test") == std::string::npos && lower_url.find("ci") == std::string::npos) {
    std::cerr << "database feature test refuses non-test database\n";
    return 1;
  }

  try {
    cleanupFeatureUsers(database_url);
    {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params(R"(
        INSERT INTO users(id, display_name, role, status, is_demo)
        VALUES ($1, 'Feature Learner', 'learner', 'active', TRUE),
               ($2, 'Feature Peer', 'learner', 'active', TRUE),
               ($3, 'Feature Supervisor', 'admin', 'active', TRUE)
      )", kLearnerId, kPeerId, kAdminId);
      /* 主管端的聚合口径已收敛到「我的团队」，测试数据必须显式建立归属，
         否则 dashboard / member list 会因团队为空而查不到这两名学员。 */
      tx.exec_params(R"(
        INSERT INTO supervisor_team_members(learner_id, supervisor_id)
        VALUES ($1, $3), ($2, $3)
      )", kLearnerId, kPeerId, kAdminId);
      const json report = {
          {"dimensionScores", {{"knowledgeAccuracy", 82}, {"medicalCompliance", 88}, {"empathy", 78},
                               {"needsDiscovery", 74}, {"serviceEtiquette", 86}}},
          {"recommendedPhrases", json::array({{{"phraseKey", "feature-phrase"}, {"round", 1},
              {"patientSays", "I am concerned about the process."},
              {"csReply", "I understand your concern. A doctor will assess the details after examination."},
              {"reason", "Keeps the clinical assessment boundary clear."}}})},
      };
      tx.exec_params(R"(
        INSERT INTO sessions
          (id, user_id, scenario_id, scenario_name, status, current_round, max_rounds, patient_state,
           started_at, updated_at, finished_at, evaluation_status, total_score)
        VALUES ($1, $2, 'implant-basic', 'Seed report', 'completed', 1, 10, '{}'::jsonb,
                NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 'ready', 82),
               ('feature-test-peer-report', $3, 'price-comparison', 'Peer report', 'completed', 1, 10, '{}'::jsonb,
                NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', 'ready', 68)
      )", kReportSessionId, kLearnerId, kPeerId);
      tx.exec_params(R"(
        INSERT INTO evaluations(session_id, status, report, model_version, prompt_version, generated_at)
        VALUES ($1, 'ready', $2::jsonb, 'feature-test', 'feature-test', NOW()),
               ('feature-test-peer-report', 'ready', $2::jsonb, 'feature-test', 'feature-test', NOW())
      )", kReportSessionId, report.dump());
      tx.commit();
    }

    ReliableDatabase database(database_url);
    require(database.healthy(), "database health did not include the new feature tables");
    const auto scenarios = database.listScenarios(kLearnerId);
    require(!scenarios["items"].empty() && scenarios["items"][0].contains("category"),
            "scenario categories were not returned");

    const auto created = database.createSession(kLearnerId, "post-treatment-discomfort");
    const auto active_session_id = created["session"]["id"].get<std::string>();
    for (int hint_number = 1; hint_number <= 3; ++hint_number) {
      const auto hint = database.requestTrainingHint(kLearnerId, active_session_id);
      require(hint["hint"]["number"].get<int>() == hint_number, "training hint number was not incremented");
      require(!hint["hint"]["content"].get<std::string>().empty(), "training hint content was empty");
    }
    try {
      (void)database.requestTrainingHint(kLearnerId, active_session_id);
      throw std::runtime_error("fourth training hint was accepted");
    } catch (const ApiError& error) {
      require(error.code == "HINT_LIMIT_REACHED", "unexpected fourth-hint error");
    }
    require(database.getSession(kLearnerId, active_session_id)["hints"].size() == 3,
            "stored training hints were not returned with the session");

    const auto phrases = database.listLearningPhrases(kLearnerId, "", "", "", false, 20);
    require(!phrases["items"].empty() && phrases["items"][0]["phraseKey"] == "feature-phrase",
            "report-derived phrase was not listed");
    /* 话术的分类必须与场景目录同源，前端筛选才有意义 */
    std::string report_category;
    for (const auto& scenario : scenarios["items"]) {
      if (scenario["id"].get<std::string>() == "implant-basic") {
        report_category = scenario["category"].get<std::string>();
      }
    }
    require(!report_category.empty(), "implant-basic scenario was missing from the catalog");
    require(phrases["items"][0]["category"].get<std::string>() == report_category,
            "listed phrase did not carry its scenario category");
    bool catalog_has_category = false;
    for (const auto& item : phrases["sceneCategories"]) {
      if (item["id"].get<std::string>() == report_category) catalog_has_category = true;
    }
    require(catalog_has_category, "scene category catalog did not include the report category");
    /* 分类筛选在 LIMIT 之前生效：命中分类能查到，其他分类必须为空 */
    const auto filtered = database.listLearningPhrases(kLearnerId, "", "", report_category, false, 20);
    require(filtered["items"].size() == 1 && filtered["items"][0]["phraseKey"] == "feature-phrase",
            "scene category filter dropped the matching phrase");
    const auto other_category = report_category == "consultation" ? "price_negotiation" : "consultation";
    const auto excluded = database.listLearningPhrases(kLearnerId, "", "", other_category, false, 20);
    require(excluded["items"].empty(), "scene category filter leaked phrases from another category");
    try {
      (void)database.listLearningPhrases(kLearnerId, "", "", "not_a_category", false, 20);
      throw std::runtime_error("unknown scene category was accepted");
    } catch (const ApiError& error) {
      require(error.code == "INVALID_ARGUMENT", "unexpected unknown-category error");
    }
    const auto favorite = database.setLearningPhraseFavorite(kLearnerId, kReportSessionId, "feature-phrase", true);
    require(favorite["favorited"].get<bool>(), "phrase favorite was not stored");
    const auto favorites = database.listLearningPhrases(kLearnerId, "", "", "", true, 20);
    require(favorites["items"].size() == 1 && favorites["items"][0]["favorited"].get<bool>(),
            "favorite-only phrase query was not user-scoped");

    const auto first_checkin = database.checkIn(kLearnerId);
    const auto second_checkin = database.checkIn(kLearnerId);
    require(first_checkin["checkedIn"].get<bool>() && first_checkin["pointsAwarded"].get<int>() == 10,
            "first daily check-in did not grant ten points");
    require(second_checkin["alreadyCheckedIn"].get<bool>() && second_checkin["pointsAwarded"].get<int>() == 0,
            "duplicate daily check-in granted points");
    const auto mine = database.learningMine(kLearnerId);
    require(mine["points"].get<int>() == 10 && mine["favoritesCount"].get<int>() == 1,
            "mine dashboard did not return the only points source and favorite count");

    const auto dashboard = database.supervisorDashboard(kAdminId, "all");
    /* 场景数刻意不写死：迁移 009 新增场景后，「== 4」这种硬编码会静默失效。
       改为与 listScenarios 的实际条数对齐，并额外确认学员练过的场景在列表里。 */
    require(dashboard["studentCount"].get<int>() >= 2,
            "supervisor aggregate did not include learner data");
    require(dashboard["scenarioStats"].size() == scenarios["items"].size(),
            "supervisor aggregate did not cover every scenario");
    {
      bool found_trained_scenario = false;
      for (const auto& stat : dashboard["scenarioStats"]) {
        if (stat.value("scenarioId", "") == "implant-basic") found_trained_scenario = true;
      }
      require(found_trained_scenario, "supervisor aggregate omitted the trained scenario");
    }
    const auto members = database.listSupervisorMembers(kAdminId, 100);
    require(hasMember(members["members"], kLearnerId) && hasMember(members["members"], kPeerId),
            "supervisor member list omitted test learners");
    const auto member = database.supervisorMemberDetail(kAdminId, kLearnerId);
    require(member["member"]["id"] == kLearnerId && member["trend"].size() >= 1 &&
            member["dimensionAverages"].contains("medicalCompliance"),
            "supervisor member detail was incomplete");

    /* ── 团队归属：候选人 → 加入 → 移出 ───────────────────────────────────
       用第三名学员串一遍完整流程，避免动到上面聚合断言依赖的归属关系。 */
    {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params(R"(
        INSERT INTO users(id, display_name, role, status, is_demo)
        VALUES ($1, 'Feature Outsider', 'learner', 'active', TRUE)
        ON CONFLICT (id) DO NOTHING
      )", kOutsiderId);
      tx.commit();
    }
    auto candidates = database.listTeamCandidates(kAdminId, 100);
    require(hasMember(candidates["candidates"], kOutsiderId),
            "unassigned learner was not offered as a team candidate");
    require(!hasMember(candidates["candidates"], kLearnerId),
            "learner already in the team leaked into the candidate list");

    const auto added = database.addTeamMembers(kAdminId, {kOutsiderId});
    require(added["addedCount"].get<int>() == 1, "team member was not added");

    /* 重复添加已归属学员：全部落空时必须明确失败，而不是回一个 addedCount=0 的
       「成功」——前端把 0 当成功会显示「已添加 0 人」，掩盖真正的原因。 */
    try {
      (void)database.addTeamMembers(kAdminId, {kOutsiderId});
      throw std::runtime_error("adding an already-assigned member was accepted");
    } catch (const ApiError& error) {
      require(error.code == "TEAM_MEMBER_UNAVAILABLE", "unexpected re-add error");
    }

    /* 已加入团队的学员不应再出现在候选名单里（一人一主管）。 */
    candidates = database.listTeamCandidates(kAdminId, 100);
    require(!hasMember(candidates["candidates"], kOutsiderId),
            "newly added member was still offered as a candidate");

    const auto teammate = database.supervisorMemberDetail(kAdminId, kOutsiderId);
    require(teammate["member"]["id"] == kOutsiderId,
            "newly added member was not readable through the supervisor detail route");

    /* 不能移出别人的成员：换一个主管身份操作必须 404。 */
    try {
      (void)database.removeTeamMember("feature-test-nobody", kOutsiderId);
      throw std::runtime_error("removing a member through a foreign supervisor succeeded");
    } catch (const ApiError& error) {
      require(error.code == "TEAM_MEMBER_NOT_FOUND", "unexpected foreign-owner removal error");
    }

    const auto removed = database.removeTeamMember(kAdminId, kOutsiderId);
    require(removed["removed"].get<bool>(), "team member was not removed");
    try {
      (void)database.supervisorMemberDetail(kAdminId, kOutsiderId);
      throw std::runtime_error("removed member was still readable by the supervisor");
    } catch (const ApiError& error) {
      require(error.code == "MEMBER_NOT_FOUND", "unexpected error after removing a member");
    }

    /* 移出后应重新变回候选人（账号与数据都保留，可再次加入）。 */
    candidates = database.listTeamCandidates(kAdminId, 100);
    require(hasMember(candidates["candidates"], kOutsiderId),
            "removed member was not restored to the candidate pool");

    /* 部分成功：本次带一个已在团队里的人 + 一个候选人，只应加入后者并回报跳过 1 人。 */
    const auto partial = database.addTeamMembers(kAdminId, {kLearnerId, kOutsiderId});
    require(partial["addedCount"].get<int>() == 1 && partial["skippedCount"].get<int>() == 1,
            "partial team add did not report added/skipped counts");

    /* 移出团队只解除归属，绝不能连带删除训练数据；移出后也应能重新加入。 */
    (void)database.removeTeamMember(kAdminId, kLearnerId);
    {
      pqxx::connection connection(database_url);
      pqxx::read_transaction tx(connection);
      const auto remaining = tx.exec_params(
          "SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1",
          kLearnerId)[0]["count"].as<int>();
      require(remaining >= 1, "removing a member from the team deleted their training sessions");
    }
    const auto restored = database.addTeamMembers(kAdminId, {kLearnerId});
    require(restored["addedCount"].get<int>() == 1, "removed member could not be re-added");

    cleanupFeatureUsers(database_url);
    std::cout << "database feature tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    try { cleanupFeatureUsers(database_url); } catch (...) {}
    std::cerr << "database feature test failed: " << error.what() << '\n';
    return 1;
  }
}
